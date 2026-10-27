// Credit codes (@profullstack/redeem-credits) and scarce invites
// (@profullstack/affiliates) for moshcoding.com.
//
// - A code grants `pro_days`: days of the paid affiliate plan ($1/mo), written
//   through grantPaidDays() (lib/plan.ts), the one place plan time is granted.
// - Each account can hand out INVITES_PER_ACCOUNT invites. An invite is
//   accepted once per account (the module refuses a second with
//   `already_invited`). Neither sign-in here verifies an email address, so the
//   bonus waits in `invite_bonuses` until the invitee clicks a signed link sent
//   to their address; then both sides get INVITE_BONUS_DAYS, once.
// - The existing ?ref= / mc_ref affiliate program is untouched: nothing here
//   calls aff.attribute(), so a sign-up is never counted twice.

import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Credits, postgresStore as creditsPg, sqliteStore as creditsSqlite } from "@profullstack/redeem-credits";
import { Affiliates, postgresStore as affPg, sqliteStore as affSqlite } from "@profullstack/affiliates";
import { connectionSettings } from "@profullstack/libsql-pg";
import pg from "pg";
import { databaseUrl, db, ensureSchema, getAccountById, type Account } from "./db";
import { grantPaidDays, toMs } from "./plan";
import { sqlTime } from "./sql-time";
import { isEmailConfigured, sendInviteConfirm } from "./email";

const require_ = createRequire(import.meta.url);
const POSTGRES_URL = /^postgres(ql)?:\/\//i;
const DAY_MS = 86_400_000;

// process.env[name] with a computed key: Next.js inlines process.env.LITERAL at build time.
const env = (name: string) => process.env[name] ?? "";
const envInt = (name: string, fallback: number) => {
  const n = Number(env(name));
  return Number.isFinite(n) && n >= 0 && env(name) !== "" ? Math.floor(n) : fallback;
};

export const CREDIT_UNIT = "pro_days";
export const INVITES_PER_ACCOUNT = 3;
export const inviteBonusDays = () => envInt("INVITE_BONUS_DAYS", 30);
/** Paid inviter bonuses per inviter per 30 days. */
export const inviteMonthlyCap = () => envInt("INVITE_MONTHLY_CAP", 5);
/** An account must be this old to send invites. */
export const inviterMinAgeHours = () => envInt("INVITE_MIN_INVITER_AGE_HOURS", 24);
/** An account older than this cannot accept an invite: invites are for new people. */
export const inviteeMaxAgeDays = () => envInt("INVITE_MAX_INVITEE_AGE_DAYS", 7);
export const INVITE_COOKIE = "mc_invite";

let _credits: Credits | undefined;
let _aff: Affiliates | undefined;
let _pool: any;

/**
 * The raw connection the module stores use. Postgres in production (the same
 * database as the app, `sslmode=` handled the way libsql-pg handles it, since
 * node-postgres treats `require` as verify-full); bun:sqlite for a `file:`
 * database in local runs and tests.
 */
function rawConnection(): { kind: "pg"; pool: any } | { kind: "sqlite"; db: any } {
  const url = databaseUrl();
  if (POSTGRES_URL.test(url)) {
    if (!_pool) {
      // The same sslmode handling as the app's own client (libsql-pg), so both
      // connections reach the database the same way. A static import: libsql-pg
      // is ESM and a server external, and require() of it from the Next bundle
      // returned no connectionSettings (prod 500 "i is not a function").
      _pool = new pg.Pool({ ...connectionSettings(url), max: 4 });
      _pool.on("error", () => {});
    }
    return { kind: "pg", pool: _pool };
  }
  const { Database } = require_("bun:sqlite");
  const path = url.slice("file:".length) || ":memory:";
  // The tests use one in-memory database per process; share the app's file otherwise.
  const sqlite = new Database(path === ":memory:" ? ":memory:" : path);
  sqlite.exec("PRAGMA busy_timeout = 5000");
  return { kind: "sqlite", db: sqlite };
}

let _conn: ReturnType<typeof rawConnection> | undefined;
const conn = () => (_conn ??= rawConnection());

export function credits(): Credits {
  if (_credits) return _credits;
  const c = conn();
  _credits = new Credits(c.kind === "pg" ? creditsPg(c.pool) : creditsSqlite(c.db), {
    // Every grant (a code redeemed, or an admin grant) lands in plan_grants.
    onGrant: async (userId, grant, source) => {
      if (grant.unit !== CREDIT_UNIT) throw new Error(`unsupported credit unit ${grant.unit}`);
      await grantPaidDays(userId, grant.amount, source);
    },
  });
  return _credits;
}

export function affiliates(): Affiliates {
  if (_aff) return _aff;
  const c = conn();
  _aff = new Affiliates(c.kind === "pg" ? affPg(c.pool) : affSqlite(c.db), { defaultQuota: INVITES_PER_ACCOUNT });
  return _aff;
}

/** For tests: forget the module instances (and their connection). */
export function resetCreditsForTests() {
  _credits = undefined;
  _aff = undefined;
  _conn = undefined;
}

export type RedeemOutcome =
  | { ok: true; days: number }
  | { ok: false; reason: "invalid" | "expired" | "used_up" | "already_redeemed" | "revoked" | "unsupported" };

export const REDEEM_MESSAGES: Record<string, string> = {
  invalid: "That code is not valid.",
  expired: "That code has expired.",
  used_up: "That code has been used up.",
  already_redeemed: "You already redeemed that code.",
  revoked: "That code was withdrawn.",
  unsupported: "That code is for something else.",
};

/**
 * Redeems a code for an account. A redemption whose grant did not land
 * (the mirror write failed) is repaired on the next attempt: the code answers
 * already_redeemed, and every code grant in the module's ledger is replayed
 * into plan_grants, which ignores the ones already there.
 */
export async function redeemCode(code: string, accountId: string): Promise<RedeemOutcome> {
  await ensureSchema();
  const r = await credits().redeem(String(code || ""), accountId);
  if (!("reason" in r)) return { ok: true, days: r.grant.amount };
  if (r.reason === "already_redeemed") await repairCodeGrants(accountId).catch(() => {});
  return { ok: false, reason: r.reason };
}

export async function repairCodeGrants(accountId: string): Promise<void> {
  for (const h of await credits().history(accountId, CREDIT_UNIT)) {
    if (h.kind === "grant" && h.source.startsWith("code:")) await grantPaidDays(accountId, h.amount, h.source);
  }
}

// ---- invites ---------------------------------------------------------------

/** One mailbox, however it is spelled: lowercased, +tag dropped, Gmail dots ignored. */
export function mailboxKey(email: string): string {
  const [local0, domain0] = String(email || "").trim().toLowerCase().split("@");
  if (!domain0) return String(email || "").trim().toLowerCase();
  let local = local0.split("+")[0];
  const domain = domain0 === "googlemail.com" ? "gmail.com" : domain0;
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isThrowawayEmail(email: string): boolean {
  try {
    const mc = require_("mailchecker");
    return !mc.isValid(String(email || ""));
  } catch {
    return false;
  }
}

function accountAgeMs(acct: Account, now = Date.now()): number {
  const created = toMs(acct.created_at);
  return Number.isFinite(created) ? now - created : 0;
}

export type InviteSendCheck = { ok: true } | { ok: false; error: string };

export async function canSendInvites(acct: Account, now = Date.now()): Promise<InviteSendCheck> {
  if (accountAgeMs(acct, now) < inviterMinAgeHours() * 3_600_000) {
    return { ok: false, error: `Invites open once your account is ${inviterMinAgeHours()} hours old.` };
  }
  return { ok: true };
}

export type AcceptOutcome =
  | { ok: true; status: "pending" | "denied"; reason?: string; inviterId: string }
  | { ok: false; reason: string };

export const ACCEPT_MESSAGES: Record<string, string> = {
  invalid: "That invite code is not valid.",
  expired: "That invite has expired.",
  used: "That invite was already used.",
  self: "You cannot use your own invite.",
  revoked: "That invite was withdrawn.",
  already_invited: "Your account has already accepted an invite.",
  too_old: "Invites are for new accounts.",
  no_account: "Sign in first.",
};

/**
 * Accepts an invite for an account. Only an account younger than
 * INVITE_MAX_INVITEE_AGE_DAYS can accept. The invite is spent by
 * redeemInvite() alone (one per account, enforced in the database); the bonus
 * is decided only after it answers ok, and waits for the email confirmation.
 */
export async function acceptInvite(code: string, accountId: string, now = Date.now()): Promise<AcceptOutcome> {
  await ensureSchema();
  const acct = await getAccountById(accountId);
  if (!acct) return { ok: false, reason: "no_account" };
  if (accountAgeMs(acct, now) > inviteeMaxAgeDays() * DAY_MS) return { ok: false, reason: "too_old" };

  const r = await affiliates().redeemInvite(String(code || ""), acct.id);
  if ("reason" in r) return { ok: false, reason: r.reason };

  const inviter = await getAccountById(r.inviterId);
  let denied: string | null = null;
  if (!inviter) denied = "inviter_gone";
  else if (acct.is_admin || inviter.is_admin) denied = "staff";
  else if (isThrowawayEmail(acct.email)) denied = "throwaway_email";
  else if (mailboxKey(acct.email) === mailboxKey(inviter.email)) denied = "same_mailbox";

  await db().execute({
    sql: `INSERT INTO invite_bonuses (invitee_id, inviter_id, invite_id, status, reason, created_at, settled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (invitee_id) DO NOTHING`,
    args: [acct.id, r.inviterId, r.inviteId, denied ? "denied" : "pending", denied, sqlTime(new Date(now)), denied ? sqlTime(new Date(now)) : null],
  });
  return denied ? { ok: true, status: "denied", reason: denied, inviterId: r.inviterId } : { ok: true, status: "pending", inviterId: r.inviterId };
}

// ---- email confirmation of the invitee ---------------------------------------

const CONFIRM_TTL_MS = 14 * DAY_MS;

function confirmKey(): string {
  const k = env("SESSION_SECRET");
  if (!k) throw new Error("SESSION_SECRET is not set");
  return k;
}

/** A signed link token: invitee account + the email it was sent to + expiry. */
export function confirmToken(accountId: string, email: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ a: accountId, e: email.toLowerCase(), x: now + CONFIRM_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", confirmKey()).update(`invite-confirm.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function readConfirmToken(token: string, now = Date.now()): { accountId: string; email: string } | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", confirmKey()).update(`invite-confirm.${body}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof d.a !== "string" || typeof d.e !== "string" || !(d.x > now)) return null;
    return { accountId: d.a, email: d.e };
  } catch {
    return null;
  }
}

export type ConfirmOutcome =
  | { ok: true; days: number; inviterPaid: boolean }
  | { ok: false; reason: "bad_link" | "email_changed" | "nothing_pending" };

/**
 * The invitee proved they read their mailbox: pay the pending bonus once.
 * The status flip (pending -> paid) is the claim; only the request that wins
 * it grants anything, and each grant is idempotent on its own source as well.
 * The inviter's half is skipped past INVITE_MONTHLY_CAP paid bonuses in 30 days.
 */
export async function confirmInvite(token: string, now = Date.now()): Promise<ConfirmOutcome> {
  await ensureSchema();
  const t = readConfirmToken(token, now);
  if (!t) return { ok: false, reason: "bad_link" };
  const acct = await getAccountById(t.accountId);
  if (!acct || acct.email.toLowerCase() !== t.email) return { ok: false, reason: "email_changed" };

  const claim = await db().execute({
    sql: `UPDATE invite_bonuses SET status = 'paid', settled_at = ?
           WHERE invitee_id = ? AND status = 'pending'
           RETURNING inviter_id, invite_id`,
    args: [sqlTime(new Date(now)), acct.id],
  });
  const row = claim.rows[0];
  if (!row) return { ok: false, reason: "nothing_pending" };
  const inviterId = String(row.inviter_id);
  const inviteId = String(row.invite_id);
  const days = inviteBonusDays();
  await grantPaidDays(acct.id, days, `invite:${inviteId}:invitee`);

  const since = sqlTime(new Date(now - 30 * DAY_MS));
  const recent = await db().execute({
    sql: `SELECT count(*) AS n FROM plan_grants WHERE account_id = ? AND source LIKE 'invite:%:inviter' AND granted_at > ?`,
    args: [inviterId, since],
  });
  let inviterPaid = false;
  if (Number((recent.rows[0] as any)?.n || 0) < inviteMonthlyCap()) {
    inviterPaid = await grantPaidDays(inviterId, days, `invite:${inviteId}:inviter`);
  } else {
    await db().execute({ sql: `UPDATE invite_bonuses SET reason = 'inviter_monthly_cap' WHERE invitee_id = ?`, args: [acct.id] });
  }
  return { ok: true, days, inviterPaid };
}

/** The account's pending invite bonus, if any (for the /invites page). */
export async function inviteBonusFor(accountId: string): Promise<{ status: string; reason: string | null } | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT status, reason FROM invite_bonuses WHERE invitee_id = ?`, args: [accountId] });
  const r = res.rows[0];
  return r ? { status: String(r.status), reason: r.reason ? String(r.reason) : null } : null;
}

/** Accepts an invite and, when a bonus is pending, emails the invitee the confirm link. */
export async function acceptInviteAndNotify(code: string, accountId: string, origin: string): Promise<AcceptOutcome> {
  const r = await acceptInvite(code, accountId);
  if (r.ok && r.status === "pending") await sendConfirmLink(accountId, origin);
  return r;
}

/** (Re)sends the confirm link for a pending bonus. False when nothing is pending. */
export async function sendConfirmLink(accountId: string, origin: string): Promise<boolean> {
  const bonus = await inviteBonusFor(accountId);
  if (!bonus || bonus.status !== "pending") return false;
  const acct = await getAccountById(accountId);
  if (!acct) return false;
  const url = `${origin.replace(/\/+$/, "")}/i/confirm?t=${encodeURIComponent(confirmToken(acct.id, acct.email))}`;
  if (!isEmailConfigured()) {
    console.log(`[invite] email not configured; confirm link for ${acct.id}: ${url}`);
    return true;
  }
  const sent = await sendInviteConfirm({ email: acct.email, url, days: inviteBonusDays() });
  if (!sent.ok) console.error("[invite] confirm email failed:", sent.error);
  return sent.ok;
}
