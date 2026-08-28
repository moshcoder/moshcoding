import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";

const { db, ensureSchema } = await import("../lib/db.ts");
const {
  openClaim,
  openClaimForTld,
  attachPayment,
  abandonClaim,
  finalizeClaim,
  sweepExpiredClaims,
  getClaim,
} = await import("../lib/moshpit-claims.ts");
const { getTld } = await import("../lib/moshpit.ts");

await ensureSchema();

let seq = 0;
/** A distinct ending per test, so one test's registration cannot leak into another's. */
const nextTld = (prefix) => `${prefix}${++seq}`;

const HOLD = { amountUsd: "10.00", holdMinutes: 30 };

/** Backdate a hold so it is expired without waiting half an hour for it. */
async function expireHold(claimId) {
  await db().execute({
    sql: `UPDATE moshpit_tld_claims SET expires_at = datetime('now','-1 minute') WHERE id = ?`,
    args: [claimId],
  });
}

test("a claim reserves the ending without registering it", async () => {
  const tld = nextTld("eggs");
  const result = await openClaim({ tld, accountId: "acct-a", ...HOLD });

  assert.equal(result.ok, true);
  assert.equal(result.claim.tld, tld);
  assert.equal(result.claim.status, "pending");
  // The whole point of the gate: nothing is registered until the money lands.
  assert.equal(await getTld(tld), null);
});

test("a second account cannot open a claim on a held ending", async () => {
  const tld = nextTld("held");
  await openClaim({ tld, accountId: "acct-a", ...HOLD });

  const second = await openClaim({ tld, accountId: "acct-b", ...HOLD });
  assert.equal(second.ok, false);
  assert.equal(second.taken, true);
  assert.match(second.error, /paying for/);
});

test("re-claiming your own held ending returns the same claim, not a second charge", async () => {
  const tld = nextTld("again");
  const first = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await attachPayment(first.claim.id, `pay-${tld}`);

  const second = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  assert.equal(second.ok, true);
  assert.equal(second.claim.id, first.claim.id);
  assert.equal(second.claim.payment_id, `pay-${tld}`);
});

test("an expired hold frees the ending for someone else", async () => {
  const tld = nextTld("lapsed");
  const first = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await expireHold(first.claim.id);

  assert.equal(await openClaimForTld(tld), null);
  const second = await openClaim({ tld, accountId: "acct-b", ...HOLD });
  assert.equal(second.ok, true);
  assert.equal(second.claim.account_id, "acct-b");
});

test("sweeping marks lapsed holds expired rather than deleting them", async () => {
  const tld = nextTld("swept");
  const claim = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await expireHold(claim.claim.id);

  await sweepExpiredClaims();
  assert.equal((await getClaim(claim.claim.id)).status, "expired");
});

test("an abandoned claim releases the ending immediately", async () => {
  const tld = nextTld("abandoned");
  const claim = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await abandonClaim(claim.claim.id);

  assert.equal(await openClaimForTld(tld), null);
  assert.equal((await openClaim({ tld, accountId: "acct-b", ...HOLD })).ok, true);
});

test("a confirmed payment registers the ending to the buyer", async () => {
  const tld = nextTld("paid");
  const claim = await openClaim({ tld, accountId: "acct-a", ownerEmail: "a@example.com", ...HOLD });
  await attachPayment(claim.claim.id, `pay-${tld}`);

  const result = await finalizeClaim(`pay-${tld}`);
  assert.equal(result.claim.status, "registered");
  assert.equal(result.tld.tld, tld);

  const owned = await getTld(tld);
  assert.equal(owned.account_id, "acct-a");
  assert.equal(owned.owner_email, "a@example.com");
});

test("finalizing twice is a no-op, not a second registration", async () => {
  const tld = nextTld("twice");
  const claim = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await attachPayment(claim.claim.id, `pay-${tld}`);

  await finalizeClaim(`pay-${tld}`);
  const again = await finalizeClaim(`pay-${tld}`);

  assert.equal(again.claim.status, "registered");
  assert.equal(again.refundDue, undefined);
  const rows = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM moshpit_tld_log WHERE tld = ? AND action = 'register'`,
    args: [tld],
  });
  assert.equal(Number(rows.rows[0].n), 1);
});

test("a payment for an unknown id is left alone", async () => {
  const result = await finalizeClaim("pay-nobody-has-this");
  assert.equal(result.unknown, true);
});

test("paying late for an ending someone else took owes a refund", async () => {
  const tld = nextTld("lost");
  const mine = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await attachPayment(mine.claim.id, `pay-${tld}`);

  // The hold lapses and the ending goes to somebody else before my money lands.
  await expireHold(mine.claim.id);
  const theirs = await openClaim({ tld, accountId: "acct-b", ...HOLD });
  await attachPayment(theirs.claim.id, `pay-${tld}-b`);
  await finalizeClaim(`pay-${tld}-b`);

  const result = await finalizeClaim(`pay-${tld}`);
  assert.equal(result.refundDue, true);
  assert.equal(result.claim.status, "refund_due");
  // The ending stays with whoever actually got it.
  assert.equal((await getTld(tld)).account_id, "acct-b");
});

test("a late payment still wins when nobody else took the ending", async () => {
  const tld = nextTld("late");
  const claim = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await attachPayment(claim.claim.id, `pay-${tld}`);
  await expireHold(claim.claim.id);
  await sweepExpiredClaims();

  // Expiry exists to stop a name being parked, not to void a paid sale that
  // cost nobody else anything.
  const result = await finalizeClaim(`pay-${tld}`);
  assert.equal(result.claim.status, "registered");
  assert.equal((await getTld(tld)).account_id, "acct-a");
});

test("a reserved name is refused before any payment is created", async () => {
  const result = await openClaim({ tld: "paypal", accountId: "acct-a", ...HOLD });
  assert.equal(result.ok, false);
  assert.equal(result.claim, undefined);
});

test("a malformed ending is refused before any payment is created", async () => {
  for (const tld of ["not.a.tld", "", "  ", "no_underscores"]) {
    const result = await openClaim({ tld, accountId: "acct-a", ...HOLD });
    assert.equal(result.ok, false, `${JSON.stringify(tld)} should not be claimable`);
  }
});

test("an ending that is already registered cannot be claimed again", async () => {
  const tld = nextTld("done");
  const claim = await openClaim({ tld, accountId: "acct-a", ...HOLD });
  await attachPayment(claim.claim.id, `pay-${tld}`);
  await finalizeClaim(`pay-${tld}`);

  const second = await openClaim({ tld, accountId: "acct-b", ...HOLD });
  assert.equal(second.ok, false);
  assert.equal(second.taken, true);
  assert.match(second.error, /already registered/);
});
