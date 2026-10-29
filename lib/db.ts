import type { Client } from "@libsql/client";
import { createClient as createPostgresClient } from "@profullstack/libsql-pg";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { WaitlistSort } from "./waitlist-filter";
import { sqlTime } from "./sql-time";
import { schemaSql } from "@profullstack/profile";
import { schemaSql as webhookSchemaSql } from "@profullstack/webhooks";
import { legacySecretToSpec } from "./webhook-legacy";

let _db: Client | undefined;
const POSTGRES_URL = /^postgres(ql)?:\/\//i;
const require_ = createRequire(import.meta.url);

/**
 * The database URL: `DATABASE_URL=postgres://...` in production (the shared
 * Postgres cluster on dev2) or a `file:` path for local runs and the tests.
 * `TURSO_DATABASE_URL` is still read as a fallback name for a `file:` URL; a
 * `libsql://` value is refused, because the data left Turso for Postgres in
 * 2026-09.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (postgres://... in production, file:... locally)");
  if (!POSTGRES_URL.test(url) && !url.startsWith("file:")) {
    throw new Error(
      `DATABASE_URL must be a postgres:// URL (production) or a file: path (local); got "${url.split(":")[0]}:". ` +
        "Turso/libsql:// is no longer supported: the data lives in Postgres now.",
    );
  }
  return url;
}

/**
 * Lazily-created singleton client. Postgres goes through @profullstack/libsql-pg,
 * which keeps the @libsql/client surface every query here was written against
 * and rewrites the SQLite idioms per statement (the CREATE TABLEs in initSchema
 * go through its schema converter). A `file:` URL loads @libsql/client lazily:
 * it is a devDependency, so the production image needs neither it nor its
 * native binding.
 */
export function db(): Client {
  if (_db) return _db;
  const url = databaseUrl();
  if (POSTGRES_URL.test(url)) {
    _db = createPostgresClient({ url }) as unknown as Client;
  } else {
    const { createClient } = require_("@libsql/client") as typeof import("@libsql/client");
    _db = createClient({ url });
  }
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
  // The CoinPay identity (OIDC `sub`) an account is bound to. CoinPay does not
  // verify email addresses (its userinfo always says email_verified=false), so
  // a CoinPay sign-in must never be matched to an account by email alone once
  // the account has another owner. See accountIdForCoinpay().
  if (await addColumnIfMissing("accounts", "coinpay_sub", "TEXT")) {
    // One time, on the deploy that adds the column: keep the links that already
    // exist (each CoinPay user who has signed in so far, to the account with
    // their email). Never re-run: a later CoinPay sign-up with somebody else's
    // address would be bound by it.
    await d.execute(`UPDATE accounts SET coinpay_sub = (
        SELECT u.sub FROM users u WHERE lower(u.email) = accounts.email LIMIT 1)
      WHERE coinpay_sub IS NULL`);
  }
  await d.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_coinpay_sub ON accounts (coinpay_sub)`);

  // ---- paid-plan grants: credit codes + invite bonuses ---------------------
  // One row per (account, source), so every grant is idempotent: `code:<id>`,
  // `invite:<inviteId>:inviter|invitee`. The paid affiliate plan ($1/mo) runs
  // until the end of the queued days (see paidUntilFromGrants in lib/plan.ts).
  await d.execute(`
    CREATE TABLE IF NOT EXISTS plan_grants (
      account_id TEXT NOT NULL,
      source     TEXT NOT NULL,
      days       INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (account_id, source)
    )
  `);
  // One row per accepted invite (the invitee). The bonus waits as 'pending'
  // until the invitee confirms their email, then is paid once.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS invite_bonuses (
      invitee_id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      invite_id  TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','denied')),
      reason     TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_invite_bonuses_inviter ON invite_bonuses (inviter_id, status)`);

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

  // ---- Moshpit TLDs: the .anything namespace (see docs/prd/0001-moshpit-namespace.md).
  //
  // Ownership is first-come-first-served, and the row is not the authority —
  // `moshpit_tld_log` is. Allocation order is what decides a contested name, so
  // it is recorded in an append-only log that can be published and audited.
  // That is what lets the directory be mirrored by anyone without letting a
  // mirror forge or seize a name: records are ordered here, verified anywhere.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS moshpit_tlds (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tld         TEXT NOT NULL UNIQUE,
      account_id  TEXT NOT NULL,
      owner_email TEXT,
      owner_key   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_moshpit_tld_account ON moshpit_tlds (account_id)`);

  // A TLD may point at another one the same owner holds: .agentic -> .agent,
  // so foo.agentic resolves to foo.agent. Added separately because the table
  // predates it and SQLite has no "ADD COLUMN IF NOT EXISTS".
  try {
    await d.execute(`ALTER TABLE moshpit_tlds ADD COLUMN alias_of TEXT`);
  } catch {
    /* already there — the only reason this fails on a healthy database */
  }
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_moshpit_tld_alias ON moshpit_tlds (alias_of)`);

  // Names held back from their TLD's alias: .financewizards -> .financialadvice
  // as a rule, but tonyrobbins.financewizards stays where it is. An operator
  // needs this the moment a name under the aliased TLD is worth more than the
  // redirect — otherwise the only way to keep one name is to not alias at all.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS moshpit_alias_exempt (
      tld        TEXT NOT NULL,
      label      TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tld, label)
    )
  `);

  // Key pins, at TLD granularity. `.eggs` publishes the keys that names under
  // it may present, so a client that resolved `scrambled.eggs` knows what to
  // expect without the registry ever having to know that `scrambled` exists.
  //
  // `kind` keeps the transports apart. A `tls` pin covers a certificate's
  // SubjectPublicKeyInfo (moshpit-proxy); an `mtp` pin covers an ML-DSA-65
  // identity (moshpit-transport). Both are SHA-256 over an SPKI, so as strings
  // they are indistinguishable — nothing but this column stops a client from
  // being handed the wrong one and failing with no idea why.
  //
  // Several rows per (tld, kind) on purpose: a key cannot rotate without a
  // window in which the old and the new one are both published.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS moshpit_tld_pins (
      tld        TEXT NOT NULL,
      pin        TEXT NOT NULL,
      kind       TEXT NOT NULL CHECK (kind IN ('tls','mtp')),
      note       TEXT,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tld, pin)
    )
  `);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_moshpit_tld_pins ON moshpit_tld_pins (tld, kind)`);

  // A paid claim in flight. Claiming an ending costs money, and a crypto
  // payment is not instant, so the name has to be held across the round-trip
  // or two people can both pay for `.eggs` and only one can have it.
  //
  // The hold is the row; `expires_at` is when it stops counting. Expired holds
  // are swept to 'expired' before any availability decision rather than being
  // filtered at read time, so the partial unique index below always describes
  // live reservations only — one open claim per ending, enforced by the
  // database instead of by whoever remembers to check.
  //
  // 'refund_due' is the case worth naming: a payment that confirms after its
  // hold lapsed and the name went to someone else. The money arrived and the
  // ending cannot be given, so the row stops being a claim and becomes a debt.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS moshpit_tld_claims (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tld         TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      owner_email TEXT,
      payment_id  TEXT UNIQUE,
      amount_usd  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','registered','expired','refund_due')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      settled_at  TEXT
    )
  `);
  await d.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_moshpit_claim_open
     ON moshpit_tld_claims (tld) WHERE status = 'pending'`,
  );
  await d.execute(
    `CREATE INDEX IF NOT EXISTS idx_moshpit_claim_account ON moshpit_tld_claims (account_id)`,
  );

  // Append-only. No UPDATE or DELETE is ever issued against this table: "who
  // claimed .eggs first" has to stay answerable after the fact, including when
  // the answer is inconvenient.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS moshpit_tld_log (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      tld        TEXT NOT NULL,
      account_id TEXT NOT NULL,
      action     TEXT NOT NULL,
      at         TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- API keys, so something other than a browser can act for an account.
  //
  // Every account-scoped endpoint authenticated by session cookie only, which
  // meant no CLI, script, or CI job could call one. For key pins that was not
  // an inconvenience but a correctness problem: a name's TLS is unverifiable
  // until its pin is published, and publishing was a person reading a hash out
  // of a script and pasting it into a form. Steps like that do not happen, so
  // most names had no pin.
  //
  // Only the hash is stored. A leaked backup of this table cannot be used to
  // authenticate, and nobody — including whoever runs the registry — can read
  // a key back out after it is created.
  //
  // `prefix` is the first few characters, kept in clear on purpose: it is what
  // lets a person recognise which key a row refers to when revoking one,
  // without it being enough to use.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS account_api_keys (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      account_id TEXT NOT NULL,
      name       TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      prefix     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used  TEXT,
      revoked_at TEXT
    )
  `);
  // Lookup is by hash on every authenticated request, so it must not be a scan.
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_account_api_keys_hash ON account_api_keys (token_hash)`);
  await d.execute(`CREATE INDEX IF NOT EXISTS idx_account_api_keys_acct ON account_api_keys (account_id)`);

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
  await ensureProfileTable();
  await ensureWebhookHub();
}

/**
 * The @profullstack/webhooks tables (its own DDL, `hub_` prefix: the plain
 * names are the pre-hub tables) and the one-time copy of the pre-hub
 * endpoints into them. INTEGER becomes bigint on Postgres (libsql-pg), which
 * the millisecond timestamps need.
 */
async function ensureWebhookHub(): Promise<void> {
  const d = db();
  for (const stmt of webhookSchemaSql("sqlite", "hub_")) await d.execute(stmt);
  await migrateLegacyWebhooks();
}

const legacyMs = (v: unknown): number => {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? "");
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(" ", "T")}Z` : s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isFinite(t) ? t : Date.now();
};

/**
 * Copies endpoints made before the hub into its table, once each (the old row
 * is stamped hub_migrated_at, so a target deleted later is not copied back).
 * Each keeps its id (routes that address it by id still work), URL,
 * subscription and on/off state. The signing key is kept byte for byte: the
 * old sender used the whole secret string as the HMAC key, the hub reads a
 * `whsec_` secret as base64, so the stored secret becomes `whsec_` + base64 of
 * the old string; the same key, so every receiver still verifies.
 */
export async function migrateLegacyWebhooks(): Promise<number> {
  const d = db();
  await addColumnIfMissing("webhook_endpoints", "hub_migrated_at", "TEXT");
  await addColumnIfMissing("domain_webhooks", "hub_migrated_at", "TEXT");
  const sources = [
    { table: "webhook_endpoints", sql: `SELECT id, project_id AS scope, url, secret, events, active, created_at FROM webhook_endpoints WHERE hub_migrated_at IS NULL`, owner: (r: any) => `project:${r.scope}` },
    { table: "domain_webhooks", sql: `SELECT id, dn AS scope, url, secret, '["*"]' AS events, active, created_at FROM domain_webhooks WHERE hub_migrated_at IS NULL`, owner: (r: any) => `dn:${String(r.scope).toLowerCase()}` },
  ];
  let copied = 0;
  for (const src of sources) {
    const rows = (await d.execute(src.sql)).rows as any[];
    for (const r of rows) {
      let events = '["*"]';
      try { const e = JSON.parse(String(r.events)); if (Array.isArray(e) && e.length) events = JSON.stringify(e.map(String)); } catch { /* all events */ }
      const at = legacyMs(r.created_at);
      await d.execute({
        sql: `INSERT INTO hub_webhook_endpoints (id, owner, url, secret, events, description, enabled, failures, disabled_reason, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, '', ?, 0, NULL, ?, ?) ON CONFLICT (id) DO NOTHING`,
        args: [String(r.id), src.owner(r), String(r.url), legacySecretToSpec(String(r.secret)), events, Number(r.active) === 1 ? 1 : 0, at, at],
      });
      await d.execute({ sql: `UPDATE ${src.table} SET hub_migrated_at = ? WHERE id = ?`, args: [sqlTime(), String(r.id)] });
      copied++;
    }
  }
  return copied;
}

/**
 * The shared profile table (@profullstack/profile), from the package's own DDL.
 * Created here rather than with the package's migrate(), whose Postgres
 * advisory lock needs one connection and libsql-pg hands out a pool. No backfill
 * from users.name: it is almost all test probes, not people.
 */
async function ensureProfileTable(): Promise<void> {
  const dialect = POSTGRES_URL.test(databaseUrl()) ? "postgres" : "sqlite";
  for (const stmt of schemaSql({ dialect, key: "user_id", keyType: "text" }).split(";\n")) {
    if (stmt.trim()) await db().execute(stmt);
  }
}

/**
 * Adds ADD COLUMN, ignoring the error when the column already exists (SQLite's
 * "duplicate column name"; on Postgres the client rewrites the statement to
 * ADD COLUMN IF NOT EXISTS, and the message form is covered anyway).
 */
/** Adds a column unless it exists. True only on the run that added it. */
async function addColumnIfMissing(table: string, column: string, type: string): Promise<boolean> {
  try {
    await db().execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    return true;
  } catch (err: any) {
    if (!/duplicate column name|already exists/i.test(String(err?.message))) throw err;
    return false;
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
             SET verified_at = COALESCE(verified_at, ?), token = NULL
           WHERE token = ?
           RETURNING email, dn`,
    args: [sqlTime(), token],
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
  /** The CoinPay `sub` this account is bound to, if any. */
  coinpay_sub: string | null;
  created_at: string | null;
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
    is_admin: Boolean(Number(r.is_admin || 0)),
    coinpay_sub: r.coinpay_sub ? String(r.coinpay_sub) : null,
    created_at: r.created_at ? String(r.created_at) : null,
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
  if (isCoinpayPlaceholderEmail(email)) throw new Error("reserved email address");
  // A domain someone else holds is never handed over by a sign-up.
  if (opts.domain && (await domainClaimedByOther(null, opts.domain))) throw new DomainTakenError(opts.domain);
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
 * Finds the account for an email, creating a passwordless one on first use
 * (the public affiliate join form). Never grants admin: no email here is
 * verified (native sign-up sends no confirmation and CoinPay's userinfo says
 * email_verified=false), so ADMIN_EMAILS cannot be trusted to promote anyone.
 * Admin is set by hand in the database.
 */
export async function findOrCreateAccountByEmail(email: string): Promise<Account> {
  await ensureSchema();
  const e = email.trim().toLowerCase();
  if (isCoinpayPlaceholderEmail(e)) throw new Error("reserved email address");
  const existing = await getAccountByEmail(e);
  if (existing) return existing;
  const res = await db().execute({
    // "oauth" sentinel hash never matches scrypt-hex, so password login stays disabled.
    sql: `INSERT INTO accounts (email, password_hash, password_salt, config, is_admin, status, plan)
          VALUES (?, 'oauth', ?, '{}', 0, 'pending', 'free')
          ON CONFLICT (email) DO UPDATE SET email = excluded.email
          RETURNING *`,
    args: [e, randomBytes(16).toString("hex")],
  });
  return rowToAccount(res.rows[0]);
}

/** Address domain for accounts made by a CoinPay sign-in. `.invalid` never
 *  resolves, so mail to it goes nowhere and nobody can sign up with it. */
export const COINPAY_PLACEHOLDER_DOMAIN = "coinpay.moshcoding.invalid";

/** The unique, unroutable account email of a CoinPay-only account. CoinPay does
 *  not verify addresses, so its email is never used as an account email. */
export function coinpayPlaceholderEmail(sub: string): string {
  return `${sub.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@${COINPAY_PLACEHOLDER_DOMAIN}`;
}

export function isCoinpayPlaceholderEmail(email: string | null | undefined): boolean {
  return String(email || "").trim().toLowerCase().endsWith(`@${COINPAY_PLACEHOLDER_DOMAIN}`);
}

/**
 * The account a CoinPay sign-in acts as. Bound by CoinPay `sub` only: CoinPay
 * does not verify email addresses, so matching on email would let anyone who
 * registers a CoinPay account with your address open your account (and, for an
 * email-only affiliate account, change its payout wallet).
 *
 * - bound to this sub: that account.
 * - otherwise: a new account bound to this sub, whose account email is an
 *   unroutable placeholder (coinpayPlaceholderEmail). The CoinPay email stays
 *   contact info in `users`.
 *
 * An existing account gets CoinPay only through linkCoinpay(), from a signed-in
 * session ("Connect CoinPay" in the dashboard). `_email` is accepted for the
 * old call sites and deliberately ignored.
 */
export async function accountIdForCoinpay(sub: string, _email?: string | null): Promise<string | null> {
  await ensureSchema();
  if (!sub || sub.startsWith("acct:")) return null;
  const bound = await db().execute({ sql: `SELECT id FROM accounts WHERE coinpay_sub = ?`, args: [sub] });
  if (bound.rows[0]) return String(bound.rows[0].id);
  // "oauth" sentinel hash never matches scrypt-hex, so password login stays off.
  // ON CONFLICT DO NOTHING: two first requests racing both land on one row.
  await db().execute({
    sql: `INSERT INTO accounts (email, password_hash, password_salt, config, is_admin, status, plan, coinpay_sub)
          VALUES (?, 'oauth', ?, '{}', 0, 'pending', 'free', ?)
          ON CONFLICT DO NOTHING`,
    args: [coinpayPlaceholderEmail(sub), randomBytes(16).toString("hex"), sub],
  });
  const made = await db().execute({ sql: `SELECT id FROM accounts WHERE coinpay_sub = ?`, args: [sub] });
  return made.rows[0] ? String(made.rows[0].id) : null;
}

export type LinkResult = { ok: boolean; reason?: "taken" | "already_linked" | "no_account" };

/**
 * Links a CoinPay identity to an account the caller is signed in to. Refused
 * when the account already has a CoinPay identity or the identity is bound to
 * another account (including one made by an earlier CoinPay-only sign-in).
 */
export async function linkCoinpay(accountId: string, sub: string): Promise<LinkResult> {
  await ensureSchema();
  if (!sub || sub.startsWith("acct:")) return { ok: false, reason: "no_account" };
  const acct = await db().execute({ sql: `SELECT coinpay_sub FROM accounts WHERE id = ?`, args: [accountId] });
  if (!acct.rows[0]) return { ok: false, reason: "no_account" };
  const current = acct.rows[0].coinpay_sub ? String(acct.rows[0].coinpay_sub) : null;
  if (current === sub) return { ok: true };
  if (current) return { ok: false, reason: "already_linked" };
  const other = await db().execute({ sql: `SELECT id FROM accounts WHERE coinpay_sub = ?`, args: [sub] });
  if (other.rows[0]) return { ok: false, reason: "taken" };
  try {
    const res = await db().execute({
      sql: `UPDATE accounts SET coinpay_sub = ? WHERE id = ? AND coinpay_sub IS NULL RETURNING id`,
      args: [sub, accountId],
    });
    return res.rows[0] ? { ok: true } : { ok: false, reason: "already_linked" };
  } catch (err: any) {
    if (/unique|duplicate/i.test(String(err?.message))) return { ok: false, reason: "taken" };
    throw err;
  }
}

/**
 * Removes the CoinPay link, but only from an account that has a password to
 * sign in with: for a CoinPay-only account it is the only way in.
 */
export async function unlinkCoinpay(accountId: string): Promise<{ ok: boolean; reason?: "only_login" | "not_linked" }> {
  await ensureSchema();
  const acct = await db().execute({ sql: `SELECT coinpay_sub, password_hash FROM accounts WHERE id = ?`, args: [accountId] });
  const r = acct.rows[0];
  if (!r || !r.coinpay_sub) return { ok: false, reason: "not_linked" };
  if (!hasPassword(r.password_hash)) return { ok: false, reason: "only_login" };
  await db().execute({ sql: `UPDATE accounts SET coinpay_sub = NULL WHERE id = ?`, args: [accountId] });
  return { ok: true };
}

/** A real password hash, not the "oauth" sentinel of a passwordless account. */
export function hasPassword(hash: unknown): boolean {
  return typeof hash === "string" && hash !== "" && hash !== "oauth";
}

/** Whether this account has CoinPay linked and could drop it. */
export async function coinpayLinkStatus(accountId: string): Promise<{ linked: boolean; canDisconnect: boolean }> {
  await ensureSchema();
  const acct = await db().execute({ sql: `SELECT coinpay_sub, password_hash FROM accounts WHERE id = ?`, args: [accountId] });
  const r = acct.rows[0];
  const linked = Boolean(r?.coinpay_sub);
  return { linked, canDisconnect: linked && hasPassword(r?.password_hash) };
}

/** Sets the tenant domain (used when a CoinPay user claims a page from the dashboard). Throws DomainTakenError for a domain another account holds. */
export async function setAccountDomain(id: string, domain: string): Promise<Account | null> {
  await ensureSchema();
  if (await domainClaimedByOther(id, domain)) throw new DomainTakenError(domain);
  const res = await db().execute({
    sql: `UPDATE accounts SET domain = ? WHERE id = ? RETURNING *`,
    args: [domain, id],
  });
  await addParkedDomain(id, domain); // register it as a parked domain too
  return res.rows[0] ? rowToAccount(res.rows[0]) : null;
}

// ---- parked domains -------------------------------------------------------

export type ParkedDomain = { domain: string; count: number; verified: number; created_at: string };

export class DomainTakenError extends Error {
  constructor(domain: string) {
    super(`${domain} is already claimed by another account.`);
    this.name = "DomainTakenError";
  }
}

/**
 * Is this domain held by an account other than `accountId` (null = anyone)?
 * A parked domain, a tenant page (including one with no owner, which only
 * staff manage) or another account's page domain all count. Claiming used to
 * reassign the domain, which let any signed-in user (or an anonymous sign-up)
 * take over somebody else's page, e.g. moshscript.com.
 */
export async function domainClaimedByOther(accountId: string | null, domain: string): Promise<boolean> {
  await ensureSchema();
  const dn = domain.trim().toLowerCase();
  const me = accountId ?? "";
  const r = await db().execute({
    sql: `SELECT 1 FROM parked_domains WHERE domain = ? AND account_id <> ?
          UNION SELECT 1 FROM tenants WHERE domain = ? AND (account_id IS NULL OR account_id <> ?)
          UNION SELECT 1 FROM accounts WHERE lower(domain) = ? AND id <> ?
          LIMIT 1`,
    args: [dn, me, dn, me, dn, me],
  });
  return r.rows.length > 0;
}

/** Registers a domain to an account (idempotent). False if another account holds it. */
export async function addParkedDomain(accountId: string, domain: string): Promise<boolean> {
  await ensureSchema();
  const dn = domain.trim().toLowerCase();
  if (await domainClaimedByOther(accountId, dn)) return false;
  await db().execute({
    sql: `INSERT INTO parked_domains (account_id, domain) VALUES (?, ?)
          ON CONFLICT (domain) DO NOTHING`,
    args: [accountId, dn],
  });
  return ownsParkedDomain(accountId, dn);
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

/** Pause or resume one inbound receiver without rotating its shared secret. */
export async function setProjectInboundWebhookActive(
  id: string,
  projectId: string,
  active: boolean,
): Promise<boolean> {
  await ensureSchema();
  const r = await db().execute({
    sql: `UPDATE inbound_webhooks SET active = ? WHERE id = ? AND project_id = ?`,
    args: [active ? 1 : 0, id, projectId],
  });
  return Number(r.rowsAffected || 0) > 0;
}

/** Delete one inbound receiver and its idempotency/event history. */
export async function deleteProjectInboundWebhook(id: string, projectId: string): Promise<boolean> {
  await ensureSchema();
  const [, receiverDelete] = await db().batch([
    {
      sql: `DELETE FROM inbound_events
            WHERE inbound_id IN (
              SELECT id FROM inbound_webhooks WHERE id = ? AND project_id = ?
            )`,
      args: [id, projectId],
    },
    {
      sql: `DELETE FROM inbound_webhooks WHERE id = ? AND project_id = ?`,
      args: [id, projectId],
    },
  ], "write");
  return Number(receiverDelete.rowsAffected || 0) > 0;
}

/** Deletes a project and its webhook config/history (SQLite has no cascade). */
export async function deleteProject(id: string): Promise<void> {
  await ensureSchema();
  const d = db();
  await d.execute({ sql: `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE project_id = ?)`, args: [id] });
  await d.execute({ sql: `DELETE FROM webhook_endpoints WHERE project_id = ?`, args: [id] });
  await d.execute({ sql: `DELETE FROM hub_webhook_deliveries WHERE owner = ?`, args: [`project:${id}`] });
  await d.execute({ sql: `DELETE FROM hub_webhook_endpoints WHERE owner = ?`, args: [`project:${id}`] });
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

// ---- per-domain webhooks (inbound; outbound targets live in lib/webhooks.ts) --

/** Is this a real domain on the platform (so we accept inbound events for it)? */
export async function isKnownDomain(dn: string): Promise<boolean> {
  await ensureSchema();
  const d = dn.trim().toLowerCase();
  const r = await db().execute({
    sql: `SELECT 1 FROM parked_domains WHERE domain = ?
          UNION SELECT 1 FROM accounts WHERE lower(domain) = ?
          UNION SELECT 1 FROM tenants  WHERE domain = ?
          UNION SELECT 1 FROM auctions WHERE domain = ?
          UNION SELECT 1 FROM hub_webhook_endpoints WHERE owner = ? LIMIT 1`,
    args: [d, d, d, d, `dn:${d}`],
  });
  return r.rows.length > 0;
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

export async function listInboundEvents(dn: string, limit = 50): Promise<{ id: string; source: string | null; event_type: string | null; payload: string; created_at: string }[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT id, source, event_type, payload, created_at FROM domain_inbound_events WHERE dn = ? ORDER BY created_at DESC LIMIT ?`,
    args: [dn.toLowerCase(), Math.min(limit, 200)],
  });
  return r.rows.map((x: any) => ({ id: String(x.id), source: x.source ? String(x.source) : null, event_type: x.event_type ? String(x.event_type) : null, payload: String(x.payload), created_at: String(x.created_at) }));
}

/** The waitlist for one domain (that the caller owns). */
export async function listDomainSignups(
  domain: string,
  limit = 1000,
  sort: WaitlistSort = "newest",
): Promise<{ email: string; verified: boolean; ref: string | null; created_at: string }[]> {
  await ensureSchema();
  const orderBy: Record<WaitlistSort, string> = {
    // lower(email) rather than COLLATE NOCASE: Postgres has no such collation,
    // and lower() sorts the same way on both databases.
    newest: "created_at DESC, lower(email) ASC, email ASC",
    oldest: "created_at ASC, lower(email) ASC, email ASC",
    email: "lower(email) ASC, email ASC, created_at DESC",
  };
  const res = await db().execute({
    sql: `SELECT email, verified_at, ref, created_at FROM signups WHERE dn = ? ORDER BY ${orderBy[sort]} LIMIT ?`,
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

/**
 * Marks an account active + paid, idempotently. Returns the (now active)
 * account, or null if not found.
 */
export async function activateAccount(opts: { accountId?: string }): Promise<Account | null> {
  await ensureSchema();
  if (!opts.accountId) return null;
  const res = await db().execute({
    sql: `UPDATE accounts
             SET status = 'active', plan = 'pro',
                 paid_at = COALESCE(paid_at, ?)
           WHERE id = ?
           RETURNING *`,
    args: [sqlTime(), opts.accountId],
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
    sql: `SELECT id FROM accounts WHERE reset_token = ? AND reset_expires > ?`,
    args: [token, sqlTime()],
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
/**
 * Upserts the tenant config rendered at ?dn=<domain>. Only the account that
 * owns the row can overwrite it; a row with no owner (staff-managed) or another
 * owner is left alone and this returns false.
 */
export async function upsertTenant(domain: string, accountId: string | null, config: Record<string, unknown>): Promise<boolean> {
  await ensureSchema();
  const res = await db().execute({
    sql: `INSERT INTO tenants (domain, account_id, config, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (domain) DO UPDATE SET
            config = excluded.config, updated_at = datetime('now')
          WHERE tenants.account_id = excluded.account_id
          RETURNING domain`,
    args: [domain.trim().toLowerCase(), accountId, JSON.stringify(config || {})],
  });
  return res.rows.length > 0;
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

/** `plan` is the effective plan (stored plan or granted days, see lib/plan.ts). */
export async function setAffiliateCommission(accountId: string, pct: number, plan?: "free" | "paid"): Promise<Affiliate | null> {
  await ensureSchema();
  const aff = await getAffiliate(accountId);
  if (!aff) return null;
  const p = normalizeAffiliateCommission(pct, plan ?? aff.plan);
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
