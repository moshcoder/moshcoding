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
