import { createClient, type Client } from "@libsql/client";
import { randomBytes } from "node:crypto";

let _db: Client | undefined;

/** Lazily-created singleton libSQL/Turso client. */
export function db(): Client {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  _db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _db;
}

let schemaReady: Promise<void> | undefined;
/** Idempotent, runs once per process. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}

async function initSchema(): Promise<void> {
  const d = db();
  await d.execute(`
    CREATE TABLE IF NOT EXISTS signups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      dn         TEXT NOT NULL DEFAULT 'moshcoding.com',
      ua         TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS signups_email_dn ON signups (email, dn)`
  );
  // Double opt-in columns. Added via ALTER so pre-existing signups tables (in
  // production) pick them up; SQLite has no ADD COLUMN IF NOT EXISTS, so we
  // swallow the "duplicate column name" error on repeat runs.
  await addColumnIfMissing("signups", "token", "TEXT");
  await addColumnIfMissing("signups", "verified_at", "TEXT");
  // Referral code from ?ref=<code> — first-touch attribution (see addSignup).
  await addColumnIfMissing("signups", "ref", "TEXT");
  await d.execute(`
    CREATE TABLE IF NOT EXISTS users (
      sub        TEXT PRIMARY KEY,
      email      TEXT,
      name       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- orgs -> teams -> projects (+ members) -----------------------------
  // Users are referenced by their OIDC `sub` (our users PK). No RLS —
  // authorization is enforced in app code (see lib/authz.ts).
  await d.execute(`
    CREATE TABLE IF NOT EXISTS orgs (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      owner_sub  TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      org_id     TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_teams_org ON teams (org_id)`);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS team_members (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      team_id    TEXT NOT NULL,
      user_sub   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'viewer'
                 CHECK (role IN ('owner','admin','member','viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (team_id, user_sub)
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_sub, team_id)`);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      team_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_projects_team ON projects (team_id)`);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS team_invitations (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      team_id     TEXT NOT NULL,
      email       TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','member','viewer')),
      token       TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(32)))),
      invited_by  TEXT NOT NULL,
      expires_at  TEXT NOT NULL DEFAULT (datetime('now','+7 days')),
      accepted_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (team_id, email)
    )
  `);

  // ---- webhooks: outbound endpoints + delivery queue ---------------------
  await d.execute(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL,
      url        TEXT NOT NULL,
      secret     TEXT NOT NULL,
      events     TEXT NOT NULL DEFAULT '["*"]',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_project ON webhook_endpoints (project_id)`);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      endpoint_id     TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      payload         TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','delivering','delivered','failed','dead_letter')),
      attempts        INTEGER NOT NULL DEFAULT 0,
      response_status INTEGER,
      last_error      TEXT,
      next_attempt_at TEXT,
      delivered_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (endpoint_id, idempotency_key)
    )
  `);

  // ---- webhooks: inbound config + idempotency ledger ---------------------
  await d.execute(`
    CREATE TABLE IF NOT EXISTS inbound_webhooks (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL,
      provider   TEXT NOT NULL,
      secret     TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, provider)
    )
  `);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS inbound_events (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      inbound_id      TEXT NOT NULL,
      provider        TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'accepted'
                      CHECK (status IN ('accepted','duplicate','rejected','failed')),
      received_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, idempotency_key)
    )
  `);

  // ---- native accounts (email+password) + paid tenant provisioning ---------
  // Separate from `users` (which is keyed by OAuth `sub`). A native session uses
  // sub = "acct:<id>". `status` goes pending -> active once the $1 setup fee is
  // paid via CoinPay; provisioning then writes the `tenants` row below.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      domain        TEXT,
      handles       TEXT NOT NULL DEFAULT '{}',
      payout_wallet TEXT,
      payout_chain  TEXT,
      plan          TEXT NOT NULL DEFAULT 'free',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
      coinpay_payment_id TEXT,
      paid_at       TEXT,
      reset_token   TEXT,
      reset_expires TEXT,
      ref           TEXT,
      config        TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_accounts_payment ON accounts (coinpay_payment_id)`);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_accounts_reset ON accounts (reset_token)`);
  // config added via ALTER for accounts tables created before it existed.
  await addColumnIfMissing("accounts", "config", "TEXT NOT NULL DEFAULT '{}'");

  // Read-model for tenant `?dn=` pages so a provisioned page renders from the DB
  // (on-disk configs/*.json don't persist on Railway). `config` is the same
  // override shape as a configs/<dn>.json file.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS tenants (
      domain     TEXT PRIMARY KEY,
      account_id TEXT,
      config     TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- affiliates: one per account, a ?ref= code + commission rate ----------
  // Free plan is floored at 80% (min payout). Paid plan ($1/mo) can lower it.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS affiliates (
      account_id     TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      commission_pct INTEGER NOT NULL DEFAULT 80,
      plan           TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','paid')),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Adds ADD COLUMN, ignoring the error when the column already exists. */
async function addColumnIfMissing(table: string, column: string, type: string): Promise<void> {
  try {
    await db().execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err: any) {
    if (!/duplicate column name/i.test(String(err?.message))) throw err;
  }
}

export type SignupResult = {
  ok: true;
  already: boolean;
  verified: boolean;
  /** Verification token for the (new or still-unverified) signup, or null once verified. */
  token: string | null;
};

/**
 * Records a waitlist signup as UNVERIFIED with a fresh verification token. On a
 * repeat signup that is still unverified it refreshes the token (so the route
 * can re-send the confirmation email); an already-verified signup is left alone.
 */
export async function addSignup(opts: {
  email: string;
  dn?: string | null;
  ua?: string | null;
  ref?: string | null;
}): Promise<SignupResult> {
  await ensureSchema();
  const domain = opts.dn || "moshcoding.com";
  const email = opts.email.toLowerCase();
  const token = randomBytes(24).toString("base64url");
  const ref = opts.ref || null;

  const res = await db().execute({
    sql: `INSERT INTO signups (email, dn, ua, token, ref) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (email, dn) DO NOTHING`,
    args: [email, domain, (opts.ua || "").slice(0, 300), token, ref],
  });
  if (res.rowsAffected > 0) {
    return { ok: true, already: false, verified: false, token };
  }

  // Already on the list — report verification state, refreshing the token for a
  // resend when they still haven't confirmed.
  const existing = await db().execute({
    sql: `SELECT verified_at FROM signups WHERE email = ? AND dn = ?`,
    args: [email, domain],
  });
  const verified = Boolean(existing.rows[0]?.verified_at);
  if (verified) return { ok: true, already: true, verified: true, token: null };

  // Refresh the token for the resend; fill in the referral code only if we
  // don't already have one (first-touch attribution — never overwrite).
  await db().execute({
    sql: `UPDATE signups SET token = ?, ref = COALESCE(ref, ?)
           WHERE email = ? AND dn = ? AND verified_at IS NULL`,
    args: [token, ref, email, domain],
  });
  return { ok: true, already: true, verified: false, token };
}

/** Marks the signup owning token as verified. Returns the row's email/dn, or null. */
export async function verifySignup(token: string): Promise<{ email: string; dn: string } | null> {
  if (!token) return null;
  await ensureSchema();
  const res = await db().execute({
    sql: `UPDATE signups
             SET verified_at = COALESCE(verified_at, datetime('now')), token = NULL
           WHERE token = ?
           RETURNING email, dn`,
    args: [token],
  });
  const row = res.rows[0];
  if (!row) return null;
  return { email: String(row.email), dn: String(row.dn) };
}

export async function signupCount(): Promise<number> {
  await ensureSchema();
  const res = await db().execute(`SELECT count(*) AS n FROM signups`);
  return Number(res.rows[0]?.n ?? 0);
}

export async function upsertUser(u: { sub: string; email?: string | null; name?: string | null }) {
  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO users (sub, email, name) VALUES (?, ?, ?)
          ON CONFLICT (sub) DO UPDATE SET
            email = excluded.email, name = excluded.name, last_login = datetime('now')`,
    args: [u.sub, u.email || null, u.name || null],
  });
}

// ---- native accounts ------------------------------------------------------

export type Account = {
  id: string;
  email: string;
  domain: string | null;
  handles: Record<string, string>;
  payout_wallet: string | null;
  payout_chain: string | null;
  plan: string;
  status: "pending" | "active";
  coinpay_payment_id: string | null;
  paid_at: string | null;
  /** Full editable tenant config (socials, customLinks, sponsors, hashtags, stream, accents, text). */
  config: Record<string, any>;
};

function rowToAccount(r: any): Account {
  let handles: Record<string, string> = {};
  try { handles = r.handles ? JSON.parse(String(r.handles)) : {}; } catch { handles = {}; }
  let config: Record<string, any> = {};
  try { config = r.config ? JSON.parse(String(r.config)) : {}; } catch { config = {}; }
  return {
    id: String(r.id),
    email: String(r.email),
    domain: r.domain ? String(r.domain) : null,
    handles,
    payout_wallet: r.payout_wallet ? String(r.payout_wallet) : null,
    payout_chain: r.payout_chain ? String(r.payout_chain) : null,
    plan: String(r.plan || "free"),
    status: (r.status === "active" ? "active" : "pending"),
    coinpay_payment_id: r.coinpay_payment_id ? String(r.coinpay_payment_id) : null,
    paid_at: r.paid_at ? String(r.paid_at) : null,
    config,
  };
}

/** Creates a native account (status='pending'). Throws on a duplicate email. */
export async function createAccount(opts: {
  email: string;
  passwordHash: string;
  passwordSalt: string;
  domain?: string | null;
  handles?: Record<string, string>;
  payoutWallet?: string | null;
  payoutChain?: string | null;
  ref?: string | null;
}): Promise<Account> {
  await ensureSchema();
  const email = opts.email.trim().toLowerCase();
  const seedConfig = Object.keys(opts.handles || {}).length ? { socials: opts.handles } : {};
  const res = await db().execute({
    sql: `INSERT INTO accounts (email, password_hash, password_salt, domain, handles, payout_wallet, payout_chain, ref, config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *`,
    args: [
      email, opts.passwordHash, opts.passwordSalt,
      opts.domain || null, JSON.stringify(opts.handles || {}),
      opts.payoutWallet || null, opts.payoutChain || null, opts.ref || null,
      JSON.stringify(seedConfig),
    ],
  });
  return rowToAccount(res.rows[0]);
}

export async function getAccountByEmail(
  email: string,
): Promise<(Account & { password_hash: string; password_salt: string }) | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT * FROM accounts WHERE email = ?`,
    args: [email.trim().toLowerCase()],
  });
  const r = res.rows[0];
  if (!r) return null;
  return { ...rowToAccount(r), password_hash: String(r.password_hash), password_salt: String(r.password_salt) };
}

export async function getAccountById(id: string): Promise<Account | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT * FROM accounts WHERE id = ?`, args: [id] });
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

/** Records the CoinPay payment id we created for a pending account's setup fee. */
export async function setAccountPayment(id: string, paymentId: string): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE accounts SET coinpay_payment_id = ? WHERE id = ?`,
    args: [paymentId, id],
  });
}

/**
 * Marks an account active + paid, idempotently. Looks the account up by the
 * CoinPay payment id (webhook path) or by account id (dev auto-activate). Returns
 * the (now active) account, or null if not found.
 */
export async function activateAccount(opts: { paymentId?: string; accountId?: string }): Promise<Account | null> {
  await ensureSchema();
  const where = opts.paymentId ? "coinpay_payment_id = ?" : "id = ?";
  const arg = opts.paymentId || opts.accountId;
  if (!arg) return null;
  const res = await db().execute({
    sql: `UPDATE accounts
             SET status = 'active', plan = 'pro',
                 paid_at = COALESCE(paid_at, datetime('now'))
           WHERE ${where}
           RETURNING *`,
    args: [arg],
  });
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

export async function setResetToken(email: string, token: string, expiresIso: string): Promise<boolean> {
  await ensureSchema();
  const res = await db().execute({
    sql: `UPDATE accounts SET reset_token = ?, reset_expires = ? WHERE email = ?`,
    args: [token, expiresIso, email.trim().toLowerCase()],
  });
  return res.rowsAffected > 0;
}

/** Returns the account id for a valid, unexpired reset token, or null. */
export async function accountForResetToken(token: string): Promise<string | null> {
  if (!token) return null;
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT id FROM accounts WHERE reset_token = ? AND reset_expires > datetime('now')`,
    args: [token],
  });
  return res.rows[0] ? String(res.rows[0].id) : null;
}

/** Updates the editable profile fields (payout wallet + social handles). */
export async function updateAccountProfile(id: string, opts: {
  payoutWallet?: string | null;
  payoutChain?: string | null;
  handles?: Record<string, string>;
}): Promise<Account | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `UPDATE accounts
             SET payout_wallet = COALESCE(?, payout_wallet),
                 payout_chain  = COALESCE(?, payout_chain),
                 handles       = COALESCE(?, handles)
           WHERE id = ?
           RETURNING *`,
    args: [
      opts.payoutWallet ?? null,
      opts.payoutChain ?? null,
      opts.handles ? JSON.stringify(opts.handles) : null,
      id,
    ],
  });
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

/** Replaces the account's editable tenant config blob. Returns the updated account. */
export async function updateAccountConfig(id: string, config: Record<string, any>): Promise<Account | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `UPDATE accounts SET config = ? WHERE id = ? RETURNING *`,
    args: [JSON.stringify(config || {}), id],
  });
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

export async function updatePassword(id: string, hash: string, salt: string): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE accounts SET password_hash = ?, password_salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?`,
    args: [hash, salt, id],
  });
}

// ---- tenant read-model ----------------------------------------------------

/** Upserts the tenant config rendered at ?dn=<domain>. `config` is override JSON. */
export async function upsertTenant(domain: string, accountId: string | null, config: Record<string, unknown>): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO tenants (domain, account_id, config, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (domain) DO UPDATE SET
            account_id = excluded.account_id, config = excluded.config, updated_at = datetime('now')`,
    args: [domain.trim().toLowerCase(), accountId, JSON.stringify(config || {})],
  });
}

// ---- affiliates -----------------------------------------------------------

export const AFFILIATE_FLOOR = 80;

export type Affiliate = { account_id: string; code: string; commission_pct: number; plan: "free" | "paid" };

function rowToAffiliate(r: any): Affiliate {
  return {
    account_id: String(r.account_id),
    code: String(r.code),
    commission_pct: Number(r.commission_pct ?? AFFILIATE_FLOOR),
    plan: r.plan === "paid" ? "paid" : "free",
  };
}

export async function getAffiliate(accountId: string): Promise<Affiliate | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT * FROM affiliates WHERE account_id = ?`, args: [accountId] });
  return res.rows[0] ? rowToAffiliate(res.rows[0]) : null;
}

/** Enrolls the account as an affiliate (idempotent). Generates a unique code. */
export async function enrollAffiliate(accountId: string): Promise<Affiliate> {
  await ensureSchema();
  const existing = await getAffiliate(accountId);
  if (existing) return existing;
  // Derive a short code; retry a couple times on the unlikely unique collision.
  for (let i = 0; i < 5; i++) {
    const code = randomBytes(5).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
    try {
      const res = await db().execute({
        sql: `INSERT INTO affiliates (account_id, code) VALUES (?, ?) RETURNING *`,
        args: [accountId, code],
      });
      return rowToAffiliate(res.rows[0]);
    } catch (err: any) {
      if (!/unique/i.test(String(err?.message))) throw err;
    }
  }
  throw new Error("could not allocate an affiliate code");
}

/** Sets the commission %, enforcing the 80% floor for free-plan affiliates. */
export async function setAffiliateCommission(accountId: string, pct: number): Promise<Affiliate | null> {
  await ensureSchema();
  const aff = await getAffiliate(accountId);
  if (!aff) return null;
  let p = Math.max(1, Math.min(100, Math.round(pct)));
  if (aff.plan !== "paid" && p < AFFILIATE_FLOOR) p = AFFILIATE_FLOOR;
  const res = await db().execute({
    sql: `UPDATE affiliates SET commission_pct = ? WHERE account_id = ? RETURNING *`,
    args: [p, accountId],
  });
  return res.rows[0] ? rowToAffiliate(res.rows[0]) : null;
}

/** Accounts that signed up with this affiliate's ref code. */
export async function listReferrals(code: string): Promise<{ email: string; domain: string | null; status: string; created_at: string }[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT email, domain, status, created_at FROM accounts WHERE ref = ? ORDER BY created_at DESC LIMIT 200`,
    args: [code],
  });
  return res.rows.map((r) => ({
    email: String(r.email),
    domain: r.domain ? String(r.domain) : null,
    status: String(r.status),
    created_at: String(r.created_at),
  }));
}

/** Loads the override config for a provisioned tenant, or null if none. */
export async function getTenantConfig(domain: string): Promise<Record<string, unknown> | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT config FROM tenants WHERE domain = ?`, args: [domain.trim().toLowerCase()] });
  const raw = res.rows[0]?.config;
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch { return null; }
}
