import { createClient, type Client } from "@libsql/client";

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

export async function addSignup(opts: { email: string; dn?: string | null; ua?: string | null }) {
  await ensureSchema();
  const domain = opts.dn || "moshcoding.com";
  const res = await db().execute({
    sql: `INSERT INTO signups (email, dn, ua) VALUES (?, ?, ?)
          ON CONFLICT (email, dn) DO NOTHING`,
    args: [opts.email.toLowerCase(), domain, (opts.ua || "").slice(0, 300)],
  });
  return { ok: true, already: res.rowsAffected === 0 };
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
