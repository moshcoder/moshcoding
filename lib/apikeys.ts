// API keys: letting something other than a browser act for an account.
//
// Every account-scoped endpoint here authenticated by session cookie alone,
// which meant no CLI, script, or CI job could call one. For key pins that was
// not an inconvenience but a correctness problem — a Moshpit name's TLS is
// unverifiable until its pin is published, and publishing meant a person
// reading a base64 hash out of a script and pasting it into a form. Steps like
// that do not happen at scale, so most names simply had no pin.
//
// Only the hash of a key is stored. A leaked backup of the table cannot be
// used to authenticate, and nobody — including whoever runs the registry — can
// read a key back after it is created. That is why creation returns the token
// exactly once and the UI has to say so.

import crypto from "node:crypto";
import { db, ensureSchema } from "./db";

/** Recognisable in a log or an env var, and greppable in a leak scan. */
const PREFIX = "mpk_";
/** Kept in clear so a person can tell two keys apart when revoking one. */
const PREFIX_KEEP = PREFIX.length + 6;

export type ApiKeyRow = {
  id: string;
  name: string | null;
  prefix: string;
  created_at: string;
  last_used: string | null;
  revoked_at: string | null;
};

/**
 * Hash a presented token.
 *
 * Plain SHA-256 rather than a password KDF, deliberately. A password is short,
 * low-entropy and guessable, so it needs a slow hash. This token is 32 random
 * bytes from a CSPRNG — brute force is not a threat model that arithmetic
 * supports — and it is verified on every API request, where a slow hash would
 * be a denial-of-service surface pointed at ourselves.
 */
function hash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 bytes of CSPRNG, base64url so it survives env vars, headers and shells. */
export function generateToken(): string {
  return PREFIX + crypto.randomBytes(32).toString("base64url");
}

/** Pull the bearer token out of a request, if it carries one. */
export function bearerToken(header: string | null | undefined): string | null {
  const value = String(header ?? "").trim();
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  const token = (match ? match[1] : value).trim();
  return token.startsWith(PREFIX) ? token : null;
}

/**
 * Mint a key. The token is returned once and never again.
 *
 * Session-authenticated callers only — a key must not be able to mint another
 * key, or a single leak becomes permanent access that survives revoking the
 * key that leaked.
 */
export async function createApiKey(accountId: string, name?: string | null): Promise<{ token: string; row: ApiKeyRow }> {
  await ensureSchema();
  const token = generateToken();
  const clean = typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
  const prefix = token.slice(0, PREFIX_KEEP);

  const created = await db().execute({
    sql: `INSERT INTO account_api_keys (account_id, name, token_hash, prefix)
          VALUES (?,?,?,?)
          RETURNING id, name, prefix, created_at, last_used, revoked_at`,
    args: [accountId, clean, hash(token), prefix],
  });

  return { token, row: created.rows[0] as unknown as ApiKeyRow };
}

/**
 * The account a token belongs to, or null.
 *
 * Looked up by hash, so the comparison happens inside the index rather than in
 * our code — there is no string compare here to leak timing, and no way to
 * probe for a valid token by measuring the response.
 *
 * A revoked key resolves to null immediately: revocation has to take effect on
 * the next request, not on the next deploy or cache expiry.
 */
export async function accountIdForToken(token: string | null | undefined): Promise<string | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  await ensureSchema();

  const found = await db().execute({
    sql: `SELECT id, account_id FROM account_api_keys WHERE token_hash = ? AND revoked_at IS NULL`,
    args: [hash(token)],
  });
  const row = found.rows[0] as unknown as { id: string; account_id: string } | undefined;
  if (!row) return null;

  // Best-effort: a failed timestamp update must not fail the request it was
  // recording. The write is only there so an unused key can be spotted later.
  db()
    .execute({ sql: `UPDATE account_api_keys SET last_used = datetime('now') WHERE id = ?`, args: [row.id] })
    .catch(() => {});

  return row.account_id;
}

/** Keys for an account. Never includes the token — it does not exist here. */
export async function listApiKeys(accountId: string): Promise<ApiKeyRow[]> {
  await ensureSchema();
  const rows = await db().execute({
    sql: `SELECT id, name, prefix, created_at, last_used, revoked_at
          FROM account_api_keys WHERE account_id = ? ORDER BY created_at DESC`,
    args: [accountId],
  });
  return rows.rows as unknown as ApiKeyRow[];
}

/**
 * Revoke a key.
 *
 * Scoped to the account in the statement itself rather than checked
 * beforehand, so there is no window between the check and the write, and no
 * way to revoke somebody else's key by guessing an id.
 */
export async function revokeApiKey(accountId: string, id: string): Promise<boolean> {
  await ensureSchema();
  const done = await db().execute({
    sql: `UPDATE account_api_keys SET revoked_at = datetime('now')
          WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
    args: [id, accountId],
  });
  return (done.rowsAffected ?? 0) > 0;
}
