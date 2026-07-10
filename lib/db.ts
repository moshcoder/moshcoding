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
