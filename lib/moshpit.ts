// The Moshpit TLD namespace — `.moshpit`, `.eggs`, `.whatever`.
//
// See docs/prd/0001-moshpit-namespace.md. Anyone can claim a TLD nobody holds;
// the operator of that TLD then owns everything under it.
//
// On authority: the `moshpit_tlds` row is a cache. `moshpit_tld_log` is the
// record. Allocating a unique name is an ordering problem, and ordering is what
// the log provides — so the directory can be mirrored and served by anyone
// without a mirror being able to forge or seize a name, because the order is
// checkable rather than trusted.

import { db, ensureSchema } from "./db";
import { normalizeTld, tldRejection } from "./moshpit-name";

export { RESERVED_TLDS, normalizeTld, tldRejection } from "./moshpit-name";

export type MoshpitTld = {
  tld: string;
  account_id: string;
  owner_email: string | null;
  created_at: string;
};

export async function getTld(tld: string): Promise<MoshpitTld | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, created_at FROM moshpit_tlds WHERE tld = ?`,
    args: [tld],
  });
  return (r.rows[0] as unknown as MoshpitTld) ?? null;
}

export async function listTlds(limit = 200): Promise<MoshpitTld[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, created_at FROM moshpit_tlds
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows as unknown as MoshpitTld[];
}

export async function listTldsForAccount(accountId: string): Promise<MoshpitTld[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, created_at FROM moshpit_tlds
          WHERE account_id = ? ORDER BY created_at DESC`,
    args: [accountId],
  });
  return r.rows as unknown as MoshpitTld[];
}

/**
 * Flat rather than a discriminated union: this project compiles with
 * `strict: false`, and without strictNullChecks TypeScript will not narrow a
 * union on a boolean discriminant — so `if (!result.ok) result.error` fails to
 * compile. A flat shape works either way.
 */
export type RegisterResult = {
  ok: boolean;
  tld?: MoshpitTld;
  error?: string;
  /** True only when the name was lost to another claim, so callers can 409. */
  taken?: boolean;
};

/**
 * Claim a TLD. First writer wins.
 *
 * The UNIQUE constraint on `tld` is what actually decides a race — checking
 * "is it free?" and then inserting would let two simultaneous claims both pass
 * the check. So the insert is the check, and a constraint violation is read as
 * "someone got there first" rather than as an error.
 */
export async function registerTld(opts: {
  tld: string;
  accountId: string;
  ownerEmail?: string | null;
  ownerKey?: string | null;
  /**
   * Register a name that is on the reserved list. Only for assigning one of
   * our own names to us — it is never reachable from the public API, because
   * the reserved list exists precisely to stop that route.
   */
  allowReserved?: boolean;
}): Promise<RegisterResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  if (!tld) return { ok: false, error: "not a valid TLD — letters, digits and dashes only, no dots" };

  const rejected = tldRejection(tld);
  if (rejected && !opts.allowReserved) return { ok: false, error: rejected };

  try {
    await db().execute({
      sql: `INSERT INTO moshpit_tlds (tld, account_id, owner_email, owner_key) VALUES (?,?,?,?)`,
      args: [tld, opts.accountId, opts.ownerEmail ?? null, opts.ownerKey ?? null],
    });
  } catch {
    const existing = await getTld(tld);
    if (existing) return { ok: false, error: `.${tld} is already registered`, taken: true };
    return { ok: false, error: "could not register that TLD" };
  }

  // Written after the row lands, so the log never claims an allocation that
  // did not happen.
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,'register')`,
    args: [tld, opts.accountId],
  });

  const created = await getTld(tld);
  return created ? { ok: true, tld: created } : { ok: false, error: "registered but could not be read back" };
}

/** The append-only allocation log — the answer to "who claimed it first". */
export async function tldLog(limit = 500) {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT seq, tld, account_id, action, at FROM moshpit_tld_log ORDER BY seq ASC LIMIT ?`,
    args: [limit],
  });
  return r.rows;
}
