// Paid claims on the Moshpit namespace: `.eggs` costs money now.
//
// Claiming used to be a single INSERT, and the UNIQUE constraint on
// `moshpit_tlds.tld` was the whole allocation story — the insert *was* the
// check. Payment breaks that, because the money and the name no longer land in
// the same instant. Between "start paying" and "confirmed" there is a window in
// which the ending is neither free nor taken, and something has to hold it.
//
// So a claim is a reservation with an expiry, and the registry is still the
// authority: the reservation only ever *delays* a registration, never performs
// one. `finalizeClaim` calls the same `registerTld` a free claim would, which
// means a paid claim cannot bypass the reserved-name list, the log, or the
// first-writer-wins constraint. If the name is gone by the time the money
// arrives, the registration correctly fails and the claim becomes a refund.

import { db, ensureSchema } from "./db";
import { registerTld, normalizeTld, tldRejection, type MoshpitTld } from "./moshpit";

export type ClaimStatus = "pending" | "registered" | "expired" | "refund_due";

export type TldClaim = {
  id: string;
  tld: string;
  account_id: string;
  owner_email: string | null;
  payment_id: string | null;
  amount_usd: string;
  status: ClaimStatus;
  created_at: string;
  expires_at: string;
  settled_at: string | null;
};

/**
 * Retire holds whose time is up.
 *
 * Called before every availability decision rather than on a timer: a sweep
 * that runs on a schedule leaves a window in which an ending reads as taken
 * because of a hold that already lapsed, and the answer a caller gets should
 * not depend on when the cleaner last ran.
 */
export async function sweepExpiredClaims(): Promise<number> {
  await ensureSchema();
  const r = await db().execute({
    sql: `UPDATE moshpit_tld_claims SET status = 'expired'
          WHERE status = 'pending' AND expires_at <= datetime('now')`,
    args: [],
  });
  return r.rowsAffected ?? 0;
}

/** The live hold on this ending, if someone is mid-payment for it. */
export async function openClaimForTld(tld: string): Promise<TldClaim | null> {
  await sweepExpiredClaims();
  const r = await db().execute({
    sql: `SELECT * FROM moshpit_tld_claims WHERE tld = ? AND status = 'pending' LIMIT 1`,
    args: [tld],
  });
  return (r.rows[0] as unknown as TldClaim) ?? null;
}

export async function getClaim(id: string): Promise<TldClaim | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT * FROM moshpit_tld_claims WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return (r.rows[0] as unknown as TldClaim) ?? null;
}

export async function getClaimByPaymentId(paymentId: string): Promise<TldClaim | null> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT * FROM moshpit_tld_claims WHERE payment_id = ? LIMIT 1`,
    args: [paymentId],
  });
  return (r.rows[0] as unknown as TldClaim) ?? null;
}

export async function listClaimsForAccount(accountId: string, limit = 50): Promise<TldClaim[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT * FROM moshpit_tld_claims WHERE account_id = ?
          ORDER BY created_at DESC LIMIT ?`,
    args: [accountId, limit],
  });
  return r.rows as unknown as TldClaim[];
}

export type OpenClaimResult = {
  ok: boolean;
  claim?: TldClaim;
  error?: string;
  /** The ending is already registered, or someone else is paying for it. */
  taken?: boolean;
};

/**
 * Reserve an ending so its payment can be created.
 *
 * Validation happens here, before any money is asked for. Charging someone for
 * a name that `registerTld` was always going to refuse — reserved, malformed,
 * already held — is the one failure this flow must not have.
 *
 * The partial unique index on `(tld) WHERE status = 'pending'` decides races,
 * for the same reason the registry's own UNIQUE does: two simultaneous claims
 * would both pass a "is anyone holding it?" read.
 */
export async function openClaim(opts: {
  tld: string;
  accountId: string;
  ownerEmail?: string | null;
  amountUsd: string;
  holdMinutes: number;
}): Promise<OpenClaimResult> {
  await ensureSchema();
  const tld = normalizeTld(opts.tld);
  if (!tld) return { ok: false, error: "not a valid TLD — letters, digits and dashes only, no dots" };

  const rejected = tldRejection(tld);
  if (rejected) return { ok: false, error: rejected };

  await sweepExpiredClaims();

  // Cheap pre-checks so the common refusals read well; the index below is what
  // actually enforces the second one.
  const existing = await db().execute({
    sql: `SELECT tld FROM moshpit_tlds WHERE tld = ? LIMIT 1`,
    args: [tld],
  });
  if (existing.rows.length) return { ok: false, error: `.${tld} is already registered`, taken: true };

  const id = crypto.randomUUID();
  try {
    await db().execute({
      sql: `INSERT INTO moshpit_tld_claims (id, tld, account_id, owner_email, amount_usd, expires_at)
            VALUES (?,?,?,?,?, datetime('now', ?))`,
      args: [id, tld, opts.accountId, opts.ownerEmail ?? null, opts.amountUsd, `+${opts.holdMinutes} minutes`],
    });
  } catch {
    const held = await openClaimForTld(tld);
    if (held) {
      return held.account_id === opts.accountId
        ? { ok: true, claim: held }
        : { ok: false, error: `someone is paying for .${tld} right now`, taken: true };
    }
    return { ok: false, error: "could not reserve that TLD" };
  }

  const claim = await getClaim(id);
  return claim ? { ok: true, claim } : { ok: false, error: "reserved but could not be read back" };
}

/** Record which payment is settling a claim. */
export async function attachPayment(claimId: string, paymentId: string): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE moshpit_tld_claims SET payment_id = ? WHERE id = ? AND payment_id IS NULL`,
    args: [paymentId, claimId],
  });
}

/** Give up a hold whose payment could not be created, so the name frees up now. */
export async function abandonClaim(claimId: string): Promise<void> {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE moshpit_tld_claims SET status = 'expired' WHERE id = ? AND status = 'pending'`,
    args: [claimId],
  });
}

export type FinalizeResult = {
  /** No claim carries this payment id — not ours to act on. */
  unknown?: boolean;
  claim?: TldClaim;
  tld?: MoshpitTld;
  /** Money in, name unavailable. Someone has to be paid back. */
  refundDue?: boolean;
  error?: string;
};

/**
 * Turn a confirmed payment into a registered ending.
 *
 * Idempotent by status: webhooks are delivered more than once, and the poll
 * fallback races the webhook by design, so this is expected to be called twice
 * for the same payment and must not register twice or throw the second time.
 *
 * A lapsed hold is deliberately NOT fatal on its own. If the payment confirms
 * late but nobody else took the ending, the honest outcome is that the buyer
 * gets what they paid for — the expiry exists to stop a name being parked, not
 * to void a sale that harmed no one. Only losing the name to someone else turns
 * this into a refund.
 */
export async function finalizeClaim(paymentId: string): Promise<FinalizeResult> {
  await ensureSchema();
  const claim = await getClaimByPaymentId(paymentId);
  if (!claim) return { unknown: true };

  if (claim.status === "registered") {
    const r = await db().execute({
      sql: `SELECT tld, account_id, owner_email, alias_of, created_at FROM moshpit_tlds WHERE tld = ?`,
      args: [claim.tld],
    });
    return { claim, tld: (r.rows[0] as unknown as MoshpitTld) ?? undefined };
  }
  if (claim.status === "refund_due") return { claim, refundDue: true };

  const result = await registerTld({
    tld: claim.tld,
    accountId: claim.account_id,
    ownerEmail: claim.owner_email,
  });

  if (!result.ok) {
    if (result.taken) {
      const owner = await db().execute({
        sql: `SELECT account_id FROM moshpit_tlds WHERE tld = ? LIMIT 1`,
        args: [claim.tld],
      });
      // Won the race after all — a duplicate delivery of a payment we already
      // settled, seen from the other side. Not a refund.
      if (String((owner.rows[0] as any)?.account_id ?? "") === claim.account_id) {
        await db().execute({
          sql: `UPDATE moshpit_tld_claims SET status = 'registered', settled_at = datetime('now') WHERE id = ?`,
          args: [claim.id],
        });
        return { claim: { ...claim, status: "registered" } };
      }

      await db().execute({
        sql: `UPDATE moshpit_tld_claims SET status = 'refund_due', settled_at = datetime('now') WHERE id = ?`,
        args: [claim.id],
      });
      console.error(
        `moshpit claim ${claim.id}: paid ${claim.amount_usd} USD for .${claim.tld} (payment ${paymentId}) ` +
          `but the ending was registered by another account — refund owed to ${claim.owner_email ?? claim.account_id}`,
      );
      return { claim: { ...claim, status: "refund_due" }, refundDue: true };
    }
    return { claim, error: result.error || "could not register that TLD" };
  }

  await db().execute({
    sql: `UPDATE moshpit_tld_claims SET status = 'registered', settled_at = datetime('now') WHERE id = ?`,
    args: [claim.id],
  });
  return { claim: { ...claim, status: "registered" }, tld: result.tld };
}
