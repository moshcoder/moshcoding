// The paid affiliate plan ($1/mo): what credit codes and invite bonuses grant.
//
// There is no recurring checkout for it yet, so `affiliates.plan = 'paid'` was
// only ever set by hand. Granted days live in `plan_grants`, one row per
// (account, source), so every grant is idempotent. The plan is paid while
// `affiliates.plan = 'paid'` or the queued grant days have not run out. A
// future $1/mo checkout should call grantPaidDays() with its payment id as the
// source, so paid and granted time share one path.

import type { CoinpayPass } from "@profullstack/coinpay-onboard/pass";
import { db, ensureSchema, enrollAffiliate } from "./db";
import { sqlTime } from "./sql-time";

export { PASS_URL } from "@profullstack/coinpay-onboard/pass";

const DAY_MS = 86_400_000;

/** A stored timestamp (SQLite text "YYYY-MM-DD HH:MM:SS", or Postgres) in ms. */
export function toMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? "");
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
  return Date.parse(iso);
}

/**
 * When the granted days run out. Grants queue: each one starts when it was
 * granted or when the previous run ends, whichever is later. Computed from the
 * rows on read, so two grants landing at once can never overwrite each other.
 */
export function paidUntilFromGrants(grants: { days: number; granted_at: unknown }[]): number | null {
  const sorted = grants
    .map((g) => ({ days: Number(g.days) || 0, at: toMs(g.granted_at) }))
    .filter((g) => g.days > 0 && Number.isFinite(g.at))
    .sort((a, b) => a.at - b.at);
  let end: number | null = null;
  for (const g of sorted) end = Math.max(end ?? 0, g.at) + g.days * DAY_MS;
  return end;
}

/** The later of the granted run and a Profullstack Pass end. */
export function laterOf(granted: number | null, pass: number | null): number | null {
  const g = granted !== null && Number.isFinite(granted) ? granted : null;
  const p = pass !== null && Number.isFinite(pass) ? pass : null;
  if (g === null) return p;
  if (p === null) return g;
  return Math.max(g, p);
}

export async function paidUntil(accountId: string): Promise<number | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT days, granted_at FROM plan_grants WHERE account_id = ?`,
    args: [accountId],
  });
  const acct = await db().execute({ sql: `SELECT coinpay_pass_until FROM accounts WHERE id = ?`, args: [accountId] });
  const pass = toMs(acct.rows[0]?.coinpay_pass_until);
  return laterOf(paidUntilFromGrants(res.rows as any), Number.isFinite(pass) ? pass : null);
}

/**
 * Profullstack Pass (https://coinpayportal.com/pass): a CoinPay user who
 * deposited $99 into their own CoinPay wallet gets a free month of the paid
 * plan on every Profullstack property. CoinPay reports it only in the userinfo
 * `pass` claim at sign-in, so the callback stores its end on the account bound
 * to the CoinPay `sub` (accountIdForCoinpay, never by email). paidUntil()
 * takes the later of it and the granted days, so the pass never uses them up.
 */
export function passUntilToStore(pass: CoinpayPass | null | undefined, now = Date.now()): string | null {
  if (!pass?.active || !pass.expiresAt) return null;
  const t = pass.expiresAt.getTime();
  return Number.isFinite(t) && t > now ? pass.expiresAt.toISOString() : null;
}

/** Stores an active pass on the account; never shortens a later one. True when it wrote. */
export async function recordCoinpayPass(accountId: string, pass: CoinpayPass | null | undefined, now = Date.now()): Promise<boolean> {
  const until = passUntilToStore(pass, now);
  if (!accountId || !until) return false;
  await ensureSchema();
  const cur = await db().execute({ sql: `SELECT coinpay_pass_until FROM accounts WHERE id = ?`, args: [accountId] });
  const had = toMs(cur.rows[0]?.coinpay_pass_until);
  if (Number.isFinite(had) && had >= Date.parse(until)) return false;
  await db().execute({ sql: `UPDATE accounts SET coinpay_pass_until = ? WHERE id = ?`, args: [until, accountId] });
  // The paid plan is the affiliate plan, so enroll like grantPaidDays() does.
  await enrollAffiliate(accountId);
  return true;
}

/**
 * Adds `days` of the paid plan, once per (account, source). Enrolls the
 * account as an affiliate first, since that is what the plan unlocks.
 * Returns true if this call added the days, false if the source was already granted.
 */
export async function grantPaidDays(accountId: string, days: number, source: string): Promise<boolean> {
  const n = Math.floor(Number(days));
  if (!accountId || !source || !Number.isFinite(n) || n <= 0) throw new Error("grantPaidDays: bad grant");
  await ensureSchema();
  await enrollAffiliate(accountId);
  const res = await db().execute({
    sql: `INSERT INTO plan_grants (account_id, source, days, granted_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (account_id, source) DO NOTHING
          RETURNING account_id`,
    args: [accountId, source, n, sqlTime()],
  });
  return res.rows.length > 0;
}

/** Is the paid plan on for this account right now? */
export async function hasPaidPlan(accountId: string, storedPlan?: string | null, now = Date.now()): Promise<boolean> {
  if (storedPlan === "paid") return true;
  const until = await paidUntil(accountId);
  return until !== null && until > now;
}
