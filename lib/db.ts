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
  await addColumnIfMissing("accounts", "is_admin", "INTEGER NOT NULL DEFAULT 0");

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

  // ---- parked domains: the domains an account owns. Each domain's waitlist is
  // kept separate (signups.dn) and managed from the dashboard.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS parked_domains (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      account_id TEXT NOT NULL,
      domain     TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_parked_account ON parked_domains (account_id)`);

  // ---- domain auctions: one per domain, runs FOREVER (no expiry) — the owner
  // collects bids until they accept one. Owner sets an optional reserve (hidden
  // from bidders) and buy-now (a bid >= buy_now auto-wins). Managed on /dashboard.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS auctions (
      domain          TEXT PRIMARY KEY,
      account_id      TEXT,
      reserve_cents   INTEGER,
      buy_now_cents   INTEGER,
      status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      accepted_bid_id TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`
    CREATE TABLE IF NOT EXISTS bids (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      domain       TEXT NOT NULL,
      bidder_email TEXT NOT NULL,
      bidder_sub   TEXT,
      amount_cents INTEGER NOT NULL,
      message      TEXT,
      status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','accepted','rejected')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_bids_domain ON bids (domain, amount_cents DESC)`);

  // ---- per-parked-domain webhooks (hosted by moshcoding, no owner server) --
  // Outbound: moshcoding POSTs domain events to the owner's target URLs.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS domain_webhooks (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      dn         TEXT NOT NULL,
      url        TEXT NOT NULL,
      secret     TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_domain_webhooks_dn ON domain_webhooks (dn)`);
  // Inbound: external services POST to /api/webhooks/<dn>; events land here.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS domain_inbound_events (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      dn         TEXT NOT NULL,
      source     TEXT,
      event_type TEXT,
      payload    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_domain_inbound_dn ON domain_inbound_events (dn, created_at)`);

  // ---- uploaded media: mp4 reels & clips, one row per file -----------------
  // Bytes live on the DATA_DIR volume (lib/media.ts); this is just metadata so
  // the gallery + dashboard can list, order, and stream them. `dn` is the parked
  // domain the reel belongs to ('moshcoding.com' for the main /videos gallery).
  await d.execute(`
    CREATE TABLE IF NOT EXISTS media (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      dn           TEXT NOT NULL,
      account_id   TEXT,
      kind         TEXT NOT NULL DEFAULT 'video',
      filename     TEXT NOT NULL,
      orig_name    TEXT,
      title        TEXT,
      content_type TEXT NOT NULL DEFAULT 'video/mp4',
      size         INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_media_dn ON media (dn, created_at)`);
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
  is_admin: boolean;
  /** Full editable tenant config (socials, customLinks, sponsors, hashtags, stream, accents, text). */
  config: Record<string, any>;
};

/** ADMIN_EMAILS (comma/space separated) skip the $1 fee and are auto-active. */
export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

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
    is_admin: Boolean(Number(r.is_admin || 0)),
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
  const account = rowToAccount(res.rows[0]);
  if (account.domain) await addParkedDomain(account.id, account.domain);
  return account;
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

/**
 * Resolves the tenant account for a signed-in user, creating a passwordless one
 * on first access. Lets CoinPay-OAuth users (who have no native password) use the
 * dashboard editor and affiliate program without a separate signup.
 */
export async function findOrCreateAccountByEmail(email: string): Promise<Account> {
  await ensureSchema();
  const e = email.trim().toLowerCase();
  const admin = isAdminEmail(e);
  let acct: Account;
  const existing = await getAccountByEmail(e);
  if (existing) {
    acct = existing;
  } else {
    const res = await db().execute({
      // "oauth" sentinel hash never matches scrypt-hex, so password login stays disabled.
      sql: `INSERT INTO accounts (email, password_hash, password_salt, config, is_admin, status, plan)
            VALUES (?, 'oauth', ?, '{}', ?, ?, ?)
            ON CONFLICT (email) DO UPDATE SET email = excluded.email
            RETURNING *`,
      args: [e, randomBytes(16).toString("hex"), admin ? 1 : 0, admin ? "active" : "pending", admin ? "pro" : "free"],
    });
    acct = rowToAccount(res.rows[0]);
  }
  // Keep admins active + flagged (no $1) even if the row predates admin status.
  if (admin && (!acct.is_admin || acct.status !== "active")) {
    const res = await db().execute({
      sql: `UPDATE accounts SET is_admin = 1, status = 'active', plan = 'pro',
                 paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ? RETURNING *`,
      args: [acct.id],
    });
    acct = rowToAccount(res.rows[0]);
  }
  return acct;
}

/** Sets the tenant domain (used when a CoinPay user claims a page from the dashboard). */
export async function setAccountDomain(id: string, domain: string): Promise<Account | null> {
  await ensureSchema();
  const res = await db().execute({
    sql: `UPDATE accounts SET domain = ? WHERE id = ? RETURNING *`,
    args: [domain, id],
  });
  await addParkedDomain(id, domain); // register it as a parked domain too
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

// ---- parked domains -------------------------------------------------------

export type ParkedDomain = { domain: string; count: number; verified: number; created_at: string };

/** Registers a domain to an account (idempotent; reassigns if re-claimed). */
export async function addParkedDomain(accountId: string, domain: string): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO parked_domains (account_id, domain) VALUES (?, ?)
          ON CONFLICT (domain) DO UPDATE SET account_id = excluded.account_id`,
    args: [accountId, domain.trim().toLowerCase()],
  });
}

/** Lists an account's parked domains with their waitlist counts. */
export async function listParkedDomains(accountId: string): Promise<ParkedDomain[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT p.domain, p.created_at,
                 (SELECT count(*) FROM signups s WHERE s.dn = p.domain) AS count,
                 (SELECT count(*) FROM signups s WHERE s.dn = p.domain AND s.verified_at IS NOT NULL) AS verified
          FROM parked_domains p WHERE p.account_id = ? ORDER BY p.created_at DESC`,
    args: [accountId],
  });
  return res.rows.map((r) => ({
    domain: String(r.domain),
    count: Number(r.count || 0),
    verified: Number(r.verified || 0),
    created_at: String(r.created_at),
  }));
}

/** Removes a parked domain (and its tenant page) from an account. */
export async function removeParkedDomain(accountId: string, domain: string): Promise<void> {
  await ensureSchema();
  const dn = domain.trim().toLowerCase();
  await db().execute({ sql: `DELETE FROM parked_domains WHERE account_id = ? AND domain = ?`, args: [accountId, dn] });
  await db().execute({ sql: `DELETE FROM tenants WHERE account_id = ? AND domain = ?`, args: [accountId, dn] });
}

export async function ownsParkedDomain(accountId: string, domain: string): Promise<boolean> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT 1 FROM parked_domains WHERE account_id = ? AND domain = ?`,
    args: [accountId, domain.trim().toLowerCase()],
  });
  return res.rows.length > 0;
}

// ---- org / team / project rename + cascade delete -------------------------
export async function renameOrg(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db().execute({ sql: `UPDATE orgs SET name = ? WHERE id = ?`, args: [name, id] });
}
export async function renameTeam(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db().execute({ sql: `UPDATE teams SET name = ? WHERE id = ?`, args: [name, id] });
}
export async function renameProject(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db().execute({ sql: `UPDATE projects SET name = ? WHERE id = ?`, args: [name, id] });
}

/** Deletes a project and its webhook config/history (SQLite has no cascade). */
export async function deleteProject(id: string): Promise<void> {
  await ensureSchema();
  const d = db();
  await d.execute({ sql: `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE project_id = ?)`, args: [id] });
  await d.execute({ sql: `DELETE FROM webhook_endpoints WHERE project_id = ?`, args: [id] });
  await d.execute({ sql: `DELETE FROM inbound_events WHERE inbound_id IN (SELECT id FROM inbound_webhooks WHERE project_id = ?)`, args: [id] });
  await d.execute({ sql: `DELETE FROM inbound_webhooks WHERE project_id = ?`, args: [id] });
  await d.execute({ sql: `DELETE FROM projects WHERE id = ?`, args: [id] });
}
/** Deletes a team, its projects (cascaded), members, and invitations. */
export async function deleteTeam(id: string): Promise<void> {
  await ensureSchema();
  const d = db();
  const projs = await d.execute({ sql: `SELECT id FROM projects WHERE team_id = ?`, args: [id] });
  for (const r of projs.rows) await deleteProject(String((r as any).id));
  await d.execute({ sql: `DELETE FROM team_members WHERE team_id = ?`, args: [id] });
  await d.execute({ sql: `DELETE FROM team_invitations WHERE team_id = ?`, args: [id] });
  await d.execute({ sql: `DELETE FROM teams WHERE id = ?`, args: [id] });
}
/** Deletes an org and every team under it (cascaded). */
export async function deleteOrg(id: string): Promise<void> {
  await ensureSchema();
  const d = db();
  const teams = await d.execute({ sql: `SELECT id FROM teams WHERE org_id = ?`, args: [id] });
  for (const r of teams.rows) await deleteTeam(String((r as any).id));
  await d.execute({ sql: `DELETE FROM orgs WHERE id = ?`, args: [id] });
}

// ---- domain auctions / bids ----------------------------------------------
export type Auction = {
  domain: string;
  account_id: string | null;
  reserve_cents: number | null;
  buy_now_cents: number | null;
  status: "open" | "closed";
  accepted_bid_id: string | null;
};
export type Bid = {
  id: string;
  domain: string;
  bidder_email: string;
  bidder_sub: string | null;
  amount_cents: number;
  message: string | null;
  status: "active" | "accepted" | "rejected";
  created_at: string;
};

const rowToAuction = (r: any): Auction => ({
  domain: String(r.domain),
  account_id: r.account_id ? String(r.account_id) : null,
  reserve_cents: r.reserve_cents == null ? null : Number(r.reserve_cents),
  buy_now_cents: r.buy_now_cents == null ? null : Number(r.buy_now_cents),
  status: r.status === "closed" ? "closed" : "open",
  accepted_bid_id: r.accepted_bid_id ? String(r.accepted_bid_id) : null,
});
const rowToBid = (r: any): Bid => ({
  id: String(r.id),
  domain: String(r.domain),
  bidder_email: String(r.bidder_email),
  bidder_sub: r.bidder_sub ? String(r.bidder_sub) : null,
  amount_cents: Number(r.amount_cents || 0),
  message: r.message ? String(r.message) : null,
  status: r.status,
  created_at: String(r.created_at),
});

export async function getAuction(dn: string): Promise<Auction | null> {
  await ensureSchema();
  const r = await db().execute({ sql: `SELECT * FROM auctions WHERE domain = ?`, args: [dn.toLowerCase()] });
  return r.rows[0] ? rowToAuction(r.rows[0]) : null;
}

/** The single highest still-standing bid (ignores rejected). */
export async function highBid(dn: string): Promise<Bid | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT * FROM bids WHERE domain = ? AND status != 'rejected' ORDER BY amount_cents DESC, created_at ASC LIMIT 1`,
    args: [dn.toLowerCase()],
  });
  return r.rows[0] ? rowToBid(r.rows[0]) : null;
}

export async function listBids(dn: string): Promise<Bid[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT * FROM bids WHERE domain = ? ORDER BY amount_cents DESC, created_at ASC`,
    args: [dn.toLowerCase()],
  });
  return r.rows.map(rowToBid);
}

/** Owner sets/updates reserve + buy-now (claims the auction). Upserts the row. */
export async function upsertAuction(opts: {
  dn: string;
  accountId: string | null;
  reserveCents: number | null;
  buyNowCents: number | null;
}): Promise<Auction> {
  await ensureSchema();
  const r = await db().execute({
    sql: `INSERT INTO auctions (domain, account_id, reserve_cents, buy_now_cents, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(domain) DO UPDATE SET
            account_id    = COALESCE(excluded.account_id, auctions.account_id),
            reserve_cents = excluded.reserve_cents,
            buy_now_cents = excluded.buy_now_cents,
            updated_at    = datetime('now')
          RETURNING *`,
    args: [opts.dn.toLowerCase(), opts.accountId, opts.reserveCents, opts.buyNowCents],
  });
  return rowToAuction(r.rows[0]);
}

/** Accepts one bid, rejects the rest, and closes the auction. */
export async function acceptBid(dn: string, bidId: string): Promise<boolean> {
  await ensureSchema();
  const d = db();
  const upd = await d.execute({
    sql: `UPDATE bids SET status = 'accepted' WHERE id = ? AND domain = ?`,
    args: [bidId, dn.toLowerCase()],
  });
  if (!upd.rowsAffected) return false;
  await d.execute({
    sql: `UPDATE bids SET status = 'rejected' WHERE domain = ? AND id != ? AND status != 'accepted'`,
    args: [dn.toLowerCase(), bidId],
  });
  await d.execute({
    sql: `UPDATE auctions SET status = 'closed', accepted_bid_id = ?, updated_at = datetime('now') WHERE domain = ?`,
    args: [bidId, dn.toLowerCase()],
  });
  return true;
}

/**
 * Places a bid. Lazily opens an auction row for the domain if none exists, so
 * every parked domain can collect offers by default. If the bid meets the
 * owner's buy-now, it auto-wins and the auction closes.
 */
export async function addBid(opts: {
  dn: string;
  email: string;
  amountCents: number;
  message?: string | null;
  sub?: string | null;
}): Promise<{ bid: Bid; won: boolean }> {
  await ensureSchema();
  const dn = opts.dn.toLowerCase();
  const d = db();
  await d.execute({ sql: `INSERT INTO auctions (domain) VALUES (?) ON CONFLICT(domain) DO NOTHING`, args: [dn] });
  const auction = await getAuction(dn);
  if (auction?.status === "closed") throw new Error("This auction is closed.");
  const ins = await d.execute({
    sql: `INSERT INTO bids (domain, bidder_email, bidder_sub, amount_cents, message) VALUES (?, ?, ?, ?, ?) RETURNING *`,
    args: [dn, opts.email.toLowerCase(), opts.sub ?? null, opts.amountCents, opts.message ?? null],
  });
  const bid = rowToBid(ins.rows[0]);
  let won = false;
  if (auction?.buy_now_cents != null && opts.amountCents >= auction.buy_now_cents) {
    await acceptBid(dn, bid.id);
    won = true;
  }
  return { bid, won };
}

/** Owner check for auction management: parked/account/tenant ownership, or admin. */
export async function accountOwnsDomain(accountId: string, dn: string): Promise<boolean> {
  await ensureSchema();
  const domain = dn.trim().toLowerCase();
  const r = await db().execute({
    sql: `SELECT 1 FROM parked_domains WHERE account_id = ? AND domain = ?
          UNION SELECT 1 FROM accounts WHERE id = ? AND lower(domain) = ?
          UNION SELECT 1 FROM tenants  WHERE account_id = ? AND domain = ?
          LIMIT 1`,
    args: [accountId, domain, accountId, domain, accountId, domain],
  });
  if (r.rows.length) return true;
  const a = await db().execute({ sql: `SELECT is_admin FROM accounts WHERE id = ?`, args: [accountId] });
  return Number((a.rows[0] as any)?.is_admin || 0) === 1;
}

// ---- per-domain webhooks (inbound + outbound) -----------------------------
export type DomainWebhook = { id: string; dn: string; url: string; secret: string; active: boolean; created_at: string };

/** Is this a real domain on the platform (so we accept inbound events for it)? */
export async function isKnownDomain(dn: string): Promise<boolean> {
  await ensureSchema();
  const d = dn.trim().toLowerCase();
  const r = await db().execute({
    sql: `SELECT 1 FROM parked_domains WHERE domain = ?
          UNION SELECT 1 FROM accounts WHERE lower(domain) = ?
          UNION SELECT 1 FROM tenants  WHERE domain = ?
          UNION SELECT 1 FROM auctions WHERE domain = ?
          UNION SELECT 1 FROM domain_webhooks WHERE dn = ? LIMIT 1`,
    args: [d, d, d, d, d],
  });
  return r.rows.length > 0;
}

export async function listDomainWebhooks(dn: string): Promise<DomainWebhook[]> {
  await ensureSchema();
  const r = await db().execute({ sql: `SELECT * FROM domain_webhooks WHERE dn = ? ORDER BY created_at`, args: [dn.toLowerCase()] });
  return r.rows.map((x: any) => ({ id: String(x.id), dn: String(x.dn), url: String(x.url), secret: String(x.secret), active: Number(x.active) === 1, created_at: String(x.created_at) }));
}

/** Active {url,secret} targets for a domain — used by fireDomainEvent. */
export async function activeDomainWebhooks(dn: string): Promise<{ url: string; secret: string }[]> {
  await ensureSchema();
  const r = await db().execute({ sql: `SELECT url, secret FROM domain_webhooks WHERE dn = ? AND active = 1`, args: [dn.toLowerCase()] });
  return r.rows.map((x: any) => ({ url: String(x.url), secret: String(x.secret) }));
}

export async function addDomainWebhook(dn: string, url: string, secret: string): Promise<DomainWebhook> {
  await ensureSchema();
  const r = await db().execute({
    sql: `INSERT INTO domain_webhooks (dn, url, secret) VALUES (?, ?, ?) RETURNING *`,
    args: [dn.toLowerCase(), url, secret],
  });
  const x: any = r.rows[0];
  return { id: String(x.id), dn: String(x.dn), url: String(x.url), secret: String(x.secret), active: true, created_at: String(x.created_at) };
}

export async function deleteDomainWebhook(id: string, dn: string): Promise<boolean> {
  await ensureSchema();
  const r = await db().execute({ sql: `DELETE FROM domain_webhooks WHERE id = ? AND dn = ?`, args: [id, dn.toLowerCase()] });
  return Number(r.rowsAffected || 0) > 0;
}

/** Stores an inbound event, keeping only the most recent 200 per domain. */
export async function recordInboundEvent(opts: { dn: string; source?: string | null; eventType?: string | null; payload: string }): Promise<void> {
  await ensureSchema();
  const dn = opts.dn.toLowerCase();
  const d = db();
  await d.execute({
    sql: `INSERT INTO domain_inbound_events (dn, source, event_type, payload) VALUES (?, ?, ?, ?)`,
    args: [dn, opts.source ?? null, opts.eventType ?? null, opts.payload.slice(0, 16000)],
  });
  await d.execute({
    sql: `DELETE FROM domain_inbound_events WHERE dn = ? AND id NOT IN
          (SELECT id FROM domain_inbound_events WHERE dn = ? ORDER BY created_at DESC LIMIT 200)`,
    args: [dn, dn],
  });
}

/** Distinct outbound webhook URLs across the given project ids — used to
 *  suggest/pre-fill a domain webhook target from the user's project webhooks. */
export async function distinctWebhookUrls(projectIds: string[]): Promise<string[]> {
  await ensureSchema();
  if (!projectIds.length) return [];
  const placeholders = projectIds.map(() => "?").join(",");
  const r = await db().execute({
    sql: `SELECT DISTINCT url FROM webhook_endpoints WHERE project_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 25`,
    args: projectIds,
  });
  return r.rows.map((x: any) => String(x.url)).filter(Boolean);
}

export async function listInboundEvents(dn: string, limit = 50): Promise<{ id: string; source: string | null; event_type: string | null; payload: string; created_at: string }[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT id, source, event_type, payload, created_at FROM domain_inbound_events WHERE dn = ? ORDER BY created_at DESC LIMIT ?`,
    args: [dn.toLowerCase(), Math.min(limit, 200)],
  });
  return r.rows.map((x: any) => ({ id: String(x.id), source: x.source ? String(x.source) : null, event_type: x.event_type ? String(x.event_type) : null, payload: String(x.payload), created_at: String(x.created_at) }));
}

/** The waitlist for one domain (that the caller owns). */
export async function listDomainSignups(domain: string, limit = 1000): Promise<{ email: string; verified: boolean; ref: string | null; created_at: string }[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT email, verified_at, ref, created_at FROM signups WHERE dn = ? ORDER BY created_at DESC LIMIT ?`,
    args: [domain.trim().toLowerCase(), limit],
  });
  return res.rows.map((r) => ({
    email: String(r.email),
    verified: Boolean(r.verified_at),
    ref: r.ref ? String(r.ref) : null,
    created_at: String(r.created_at),
  }));
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
    // reset_expires is stored as an ISO-8601 string (Date#toISOString, e.g.
    // "2026-07-20T20:53:43.696Z"); compare it against an ISO "now" so the check
    // is a like-for-like lexical comparison. Comparing against SQLite's
    // datetime('now') ("2026-07-20 21:23:43") instead makes the "T" separator
    // (0x54) always sort after the space (0x20), so an expired token would read
    // as still valid for the rest of the UTC day.
    sql: `SELECT id FROM accounts WHERE reset_token = ? AND reset_expires > ?`,
    args: [token, new Date().toISOString()],
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
export function normalizeAffiliateCommission(pct: number, plan: "free" | "paid"): number {
  let p = Number.isFinite(pct) ? Math.max(1, Math.min(100, Math.round(pct))) : AFFILIATE_FLOOR;
  if (plan !== "paid" && p < AFFILIATE_FLOOR) p = AFFILIATE_FLOOR;
  return p;
}

export async function setAffiliateCommission(accountId: string, pct: number): Promise<Affiliate | null> {
  await ensureSchema();
  const aff = await getAffiliate(accountId);
  if (!aff) return null;
  const p = normalizeAffiliateCommission(pct, aff.plan);
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

// ---- uploaded media (mp4 reels) -------------------------------------------

export type Media = {
  id: string;
  dn: string;
  account_id: string | null;
  kind: string;
  filename: string;
  orig_name: string | null;
  title: string | null;
  content_type: string;
  size: number;
  created_at: string;
};

function rowToMedia(r: any): Media {
  return {
    id: String(r.id),
    dn: String(r.dn),
    account_id: r.account_id ? String(r.account_id) : null,
    kind: String(r.kind || "video"),
    filename: String(r.filename),
    orig_name: r.orig_name ? String(r.orig_name) : null,
    title: r.title ? String(r.title) : null,
    content_type: String(r.content_type || "video/mp4"),
    size: Number(r.size || 0),
    created_at: String(r.created_at),
  };
}

/** Inserts a media row. The caller has already written the bytes to the volume. */
export async function addMedia(opts: {
  id: string;
  dn: string;
  accountId: string | null;
  filename: string;
  origName?: string | null;
  title?: string | null;
  contentType?: string;
  size?: number;
}): Promise<Media> {
  await ensureSchema();
  const res = await db().execute({
    sql: `INSERT INTO media (id, dn, account_id, filename, orig_name, title, content_type, size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [
      opts.id,
      opts.dn.trim().toLowerCase(),
      opts.accountId,
      opts.filename,
      opts.origName ?? null,
      opts.title ?? null,
      opts.contentType || "video/mp4",
      opts.size || 0,
    ],
  });
  return rowToMedia(res.rows[0]);
}

/** Reels for a domain, newest first. */
export async function listMedia(dn: string, limit = 200): Promise<Media[]> {
  await ensureSchema();
  const res = await db().execute({
    sql: `SELECT * FROM media WHERE dn = ? ORDER BY created_at DESC LIMIT ?`,
    args: [dn.trim().toLowerCase(), Math.min(limit, 500)],
  });
  return res.rows.map(rowToMedia);
}

export async function getMedia(id: string): Promise<Media | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT * FROM media WHERE id = ?`, args: [id] });
  return res.rows[0] ? rowToMedia(res.rows[0]) : null;
}

/** Deletes the row and returns it (so the caller can unlink the file), or null. */
export async function deleteMedia(id: string): Promise<Media | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `DELETE FROM media WHERE id = ? RETURNING *`, args: [id] });
  return res.rows[0] ? rowToMedia(res.rows[0]) : null;
}

/** Loads the override config for a provisioned tenant, or null if none. */
export async function getTenantConfig(domain: string): Promise<Record<string, unknown> | null> {
  await ensureSchema();
  const res = await db().execute({ sql: `SELECT config FROM tenants WHERE domain = ?`, args: [domain.trim().toLowerCase()] });
  const raw = res.rows[0]?.config;
  if (!raw) return null;
  try { return JSON.parse(String(raw)); } catch { return null; }
}
