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
import { normalizeTld, parseMoshpitName, tldRejection } from "./moshpit-name";

export { RESERVED_TLDS, normalizeTld, parseMoshpitName, tldRejection } from "./moshpit-name";

export type MoshpitTld = {
  tld: string;
  account_id: string;
  owner_email: string | null;
  /** The TLD this one points at, or null when it stands on its own. */
  alias_of: string | null;
  created_at: string;
};

export async function getTld(tld: string): Promise<MoshpitTld | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, alias_of, created_at FROM moshpit_tlds WHERE tld = ?`,
    args: [tld],
  });
  return (r.rows[0] as unknown as MoshpitTld) ?? null;
}

export async function listTlds(limit = 200): Promise<MoshpitTld[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, alias_of, created_at FROM moshpit_tlds
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows as unknown as MoshpitTld[];
}

export async function listTldsForAccount(accountId: string): Promise<MoshpitTld[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT tld, account_id, owner_email, alias_of, created_at FROM moshpit_tlds
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


export type AliasResult = { ok: boolean; error?: string };

/**
 * Point one TLD at another: `.agentic` -> `.agent`, so `foo.agentic` resolves
 * to `foo.agent`.
 *
 * Both must be held by the same account. Aliasing a name you do not own would
 * turn this into a land-grab — claim `.agent`, then absorb forty related words
 * without registering any of them — and first-come-first-served would stop
 * meaning anything.
 *
 * Chains are rejected rather than followed. A TLD is either a target or an
 * alias, never both, which makes resolution a single hop and makes a cycle
 * impossible to construct in the first place, instead of something to detect
 * at read time forever after.
 */
export async function setAlias(opts: {
  from: string;
  to: string;
  accountId: string;
}): Promise<AliasResult> {
  await ensureSchema();
  const from = normalizeTld(opts.from);
  const to = normalizeTld(opts.to);
  if (!from || !to) return { ok: false, error: "not a valid TLD" };
  if (from === to) return { ok: false, error: "a TLD cannot point at itself" };

  const [source, target] = await Promise.all([getTld(from), getTld(to)]);
  if (!source) return { ok: false, error: `.${from} is not registered` };
  if (!target) return { ok: false, error: `.${to} is not registered` };
  if (source.account_id !== opts.accountId) return { ok: false, error: `you do not own .${from}` };
  if (target.account_id !== opts.accountId) return { ok: false, error: `you do not own .${to}` };
  if (target.alias_of) {
    return { ok: false, error: `.${to} already points at .${target.alias_of} — point at the destination instead` };
  }

  const pointedHere = await db().execute({
    sql: `SELECT tld FROM moshpit_tlds WHERE alias_of = ? LIMIT 1`,
    args: [from],
  });
  if (pointedHere.rows.length) {
    return {
      ok: false,
      error: `.${pointedHere.rows[0].tld} already points at .${from}, so it cannot point elsewhere itself`,
    };
  }

  await db().execute({ sql: `UPDATE moshpit_tlds SET alias_of = ? WHERE tld = ?`, args: [to, from] });
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,?)`,
    args: [from, opts.accountId, `alias:${to}`],
  });
  return { ok: true };
}

/** Stop pointing `.from` anywhere. */
export async function clearAlias(from: string, accountId: string): Promise<AliasResult> {
  await ensureSchema();
  const tld = normalizeTld(from);
  if (!tld) return { ok: false, error: "not a valid TLD" };
  const existing = await getTld(tld);
  if (!existing) return { ok: false, error: `.${tld} is not registered` };
  if (existing.account_id !== accountId) return { ok: false, error: `you do not own .${tld}` };

  await db().execute({ sql: `UPDATE moshpit_tlds SET alias_of = NULL WHERE tld = ?`, args: [tld] });
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,'unalias')`,
    args: [tld, accountId],
  });
  return { ok: true };
}

export type Resolution = {
  name: string;
  /** Where it actually points — the same name when nothing is aliased. */
  resolved: string;
  aliased: boolean;
  registered: boolean;
  /** Held back from its TLD's alias by the operator. */
  exempt?: boolean;
};

/**
 * Resolve `foo.agentic` to `foo.agent`.
 *
 * The label is carried across rather than dropped: an alias redirects the
 * namespace, not the name. `.agentic` pointing at `.agent` means every name
 * under it keeps its own identity on the other side.
 */
export async function resolveMoshpitName(input: string): Promise<Resolution | null> {
  await ensureSchema();
  const parsed = parseMoshpitName(input);
  if (!parsed) return null;
  const { label, tld } = parsed;
  const owner = await getTld(tld);
  if (!owner) return { name: `${label}.${tld}`, resolved: `${label}.${tld}`, aliased: false, registered: false };
  if (!owner.alias_of) {
    return { name: `${label}.${tld}`, resolved: `${label}.${tld}`, aliased: false, registered: true };
  }

  // An exempt name outranks the alias. Checked here rather than at write time
  // because the exemption has to survive the alias being repointed later.
  if (await isExempt(tld, label)) {
    return { name: `${label}.${tld}`, resolved: `${label}.${tld}`, aliased: false, registered: true, exempt: true };
  }

  return {
    name: `${label}.${tld}`,
    resolved: `${label}.${owner.alias_of}`,
    aliased: true,
    registered: true,
  };
}


/** Is this name held back from its TLD's alias? */
export async function isExempt(tld: string, label: string): Promise<boolean> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT 1 FROM moshpit_alias_exempt WHERE tld = ? AND label = ? LIMIT 1`,
    args: [tld, label],
  });
  return r.rows.length > 0;
}

export async function listExempt(tld: string): Promise<string[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT label FROM moshpit_alias_exempt WHERE tld = ? ORDER BY label`,
    args: [tld],
  });
  return r.rows.map((row) => String(row.label));
}

/**
 * Hold `label.tld` back from `.tld`'s alias, so it keeps resolving to itself.
 *
 * Allowed even when no alias is set yet: an operator should be able to carve
 * out the names they intend to keep BEFORE pointing the TLD somewhere, rather
 * than having to redirect everyone first and repair it afterwards.
 */
export async function setExempt(opts: {
  tld: string;
  label: string;
  accountId: string;
}): Promise<AliasResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  const label = normalizeTld(opts.label);
  if (!tld || !label) return { ok: false, error: "not a valid name" };

  const owner = await getTld(tld);
  if (!owner) return { ok: false, error: `.${tld} is not registered` };
  if (owner.account_id !== opts.accountId) return { ok: false, error: `you do not own .${tld}` };

  await db().execute({
    sql: `INSERT OR IGNORE INTO moshpit_alias_exempt (tld, label, account_id) VALUES (?,?,?)`,
    args: [tld, label, opts.accountId],
  });
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,?)`,
    args: [tld, opts.accountId, `exempt:${label}`],
  });
  return { ok: true };
}

/** Let `label.tld` follow the alias again. */
export async function clearExempt(opts: {
  tld: string;
  label: string;
  accountId: string;
}): Promise<AliasResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  const label = normalizeTld(opts.label);
  if (!tld || !label) return { ok: false, error: "not a valid name" };

  const owner = await getTld(tld);
  if (!owner) return { ok: false, error: `.${tld} is not registered` };
  if (owner.account_id !== opts.accountId) return { ok: false, error: `you do not own .${tld}` };

  await db().execute({
    sql: `DELETE FROM moshpit_alias_exempt WHERE tld = ? AND label = ?`,
    args: [tld, label],
  });
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,?)`,
    args: [tld, opts.accountId, `unexempt:${label}`],
  });
  return { ok: true };
}

// ---- key pins --------------------------------------------------------------
//
// A TLD publishes the keys that names under it are allowed to present. Pinning
// at this granularity rather than per name follows from how the namespace is
// actually held: you claim `.eggs`, not `scrambled.eggs`, so the registry has
// no row for an individual name to hang a key on and would have to invent one.
//
// The trade is honest and worth stating. Every name under a TLD shares a key,
// so the operator of `.eggs` can impersonate any name under it — which they
// could do anyway, since they own the namespace and decide where its names
// point. What this does not give you is isolation *between* names under one
// TLD, which would need a per-name registry and a rotation story for each.

export type PinKind = "tls" | "mtp";
export const PIN_KINDS: readonly PinKind[] = ["tls", "mtp"];

export type MoshpitPin = {
  tld: string;
  pin: string;
  kind: PinKind;
  note: string | null;
  created_at: string;
};

export type PinResult = { ok: boolean; error?: string; taken?: boolean };

/**
 * A pin is SHA-256 over a SubjectPublicKeyInfo, base64 — always 32 bytes, so
 * always 44 characters ending in one '='. Checked rather than trusted because
 * a malformed pin is indistinguishable from a key that simply never matches:
 * the connection fails, and nothing anywhere says why.
 */
export function isPin(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value, "base64").length === 32;
}

export function normalizePinKind(value: unknown): PinKind | null {
  const kind = String(value ?? "").trim().toLowerCase();
  return (PIN_KINDS as readonly string[]).includes(kind) ? (kind as PinKind) : null;
}

export async function listPins(tld: string, kind?: PinKind | null): Promise<MoshpitPin[]> {
  await ensureSchema();
  const normalized = normalizeTld(tld);
  if (!normalized) return [];

  const r = await db().execute(
    kind
      ? {
          sql: `SELECT tld, pin, kind, note, created_at FROM moshpit_tld_pins
                WHERE tld = ? AND kind = ? ORDER BY created_at DESC`,
          args: [normalized, kind],
        }
      : {
          sql: `SELECT tld, pin, kind, note, created_at FROM moshpit_tld_pins
                WHERE tld = ? ORDER BY kind, created_at DESC`,
          args: [normalized],
        },
  );
  return r.rows as unknown as MoshpitPin[];
}

export type PinsForName = {
  name: string;
  /** Where the name actually points; pins come from this TLD, not the typed one. */
  resolved: string;
  tld: string;
  pins: MoshpitPin[];
};

/**
 * The pins a client should accept for `scrambled.eggs`.
 *
 * Aliases are followed first. When `.agentic` points at `.agent`, a client
 * asking about `foo.agentic` is going to connect to whatever serves
 * `foo.agent`, so the keys that matter are `.agent`'s. Answering with
 * `.agentic`'s pins would refuse every working connection.
 */
export async function pinsForName(input: string, kind?: PinKind | null): Promise<PinsForName | null> {
  const resolution = await resolveMoshpitName(input);
  if (!resolution) return null;

  // An unregistered TLD is not a Moshpit name, and saying so matters. Without
  // this check `example.com` parses as label `example` under TLD `com`, nobody
  // holds `.com`, and the caller is told "registered, no key published" about
  // a clearnet name it should have been told to leave alone. The two answers
  // are cached differently by clients and mean different things.
  if (!resolution.registered) return null;

  const parsed = parseMoshpitName(resolution.resolved);
  if (!parsed) return null;

  return {
    name: resolution.name,
    resolved: resolution.resolved,
    tld: parsed.tld,
    pins: await listPins(parsed.tld, kind),
  };
}

export async function addPin(opts: {
  tld: string;
  pin: string;
  kind: unknown;
  note?: unknown;
  accountId: string;
}): Promise<PinResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  if (!tld) return { ok: false, error: "not a valid TLD" };
  if (!isPin(opts.pin)) {
    return { ok: false, error: "pin must be base64 SHA-256 over a SubjectPublicKeyInfo (44 chars)" };
  }
  const kind = normalizePinKind(opts.kind);
  if (!kind) return { ok: false, error: `kind must be one of ${PIN_KINDS.join(", ")}` };

  const owner = await getTld(tld);
  if (!owner) return { ok: false, error: `.${tld} is not registered` };
  if (owner.account_id !== opts.accountId) return { ok: false, error: `you do not own .${tld}` };

  const note = typeof opts.note === "string" && opts.note.trim() ? opts.note.trim().slice(0, 200) : null;

  // A pin already present under a different kind is a mistake worth naming.
  // Silently ignoring it would leave the operator convinced they published an
  // `mtp` key while clients keep being told it is `tls`.
  const existing = await db().execute({
    sql: `SELECT kind FROM moshpit_tld_pins WHERE tld = ? AND pin = ?`,
    args: [tld, opts.pin],
  });
  const priorKind = (existing.rows[0] as unknown as { kind: PinKind } | undefined)?.kind;
  if (priorKind && priorKind !== kind) {
    return { ok: false, error: `that pin is already published for .${tld} as ${priorKind}`, taken: true };
  }
  if (priorKind === kind) return { ok: true };

  await db().execute({
    sql: `INSERT INTO moshpit_tld_pins (tld, pin, kind, note, account_id) VALUES (?,?,?,?,?)`,
    args: [tld, opts.pin, kind, note, opts.accountId],
  });
  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,?)`,
    args: [tld, opts.accountId, `pin:add:${kind}:${opts.pin}`],
  });
  return { ok: true };
}

/**
 * Withdraw a key.
 *
 * Removing the last pin of a kind is allowed. It means "no key published",
 * which clients treat as a refusal rather than as permission — so this is how
 * an operator takes a compromised key out of service, and it must not be
 * blocked on the grounds that it breaks connections. Breaking them is the point.
 */
export async function removePin(opts: {
  tld: string;
  pin: string;
  accountId: string;
}): Promise<PinResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  if (!tld) return { ok: false, error: "not a valid TLD" };

  const owner = await getTld(tld);
  if (!owner) return { ok: false, error: `.${tld} is not registered` };
  if (owner.account_id !== opts.accountId) return { ok: false, error: `you do not own .${tld}` };

  const r = await db().execute({
    sql: `DELETE FROM moshpit_tld_pins WHERE tld = ? AND pin = ?`,
    args: [tld, opts.pin],
  });
  if (!r.rowsAffected) return { ok: false, error: "that pin is not published for this TLD" };

  await db().execute({
    sql: `INSERT INTO moshpit_tld_log (tld, account_id, action) VALUES (?,?,?)`,
    args: [tld, opts.accountId, `pin:remove:${opts.pin}`],
  });
  return { ok: true };
}
