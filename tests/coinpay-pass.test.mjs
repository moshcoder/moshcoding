import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret";

const dbm = await import("../lib/db.ts");
const plan = await import("../lib/plan.ts");
const { passFromUserinfo } = await import("@profullstack/coinpay-onboard/pass");
await dbm.ensureSchema();

const DAY = 86_400_000;
const inDays = (d) => new Date(Date.now() + d * DAY).toISOString();
const claim = (pass) => passFromUserinfo({ pass });

test("only an active pass with a future end is stored", () => {
  const end = inDays(30);
  assert.equal(plan.passUntilToStore(claim({ active: true, expires_at: end })), end);
  assert.equal(plan.passUntilToStore(claim({ active: false, expires_at: end })), null);
  assert.equal(plan.passUntilToStore(claim({ active: true, expires_at: "nope" })), null);
  assert.equal(plan.passUntilToStore(claim({ active: true, expires_at: inDays(-1) })), null);
  assert.equal(plan.passUntilToStore(undefined), null);
});

test("a pass turns on the paid plan for the sub-bound account until it ends", async () => {
  const id = await dbm.accountIdForCoinpay("pass-sub-1");
  assert.equal(await plan.hasPaidPlan(id, "free"), false);
  const end = inDays(30);
  assert.equal(await plan.recordCoinpayPass(id, claim({ active: true, expires_at: end })), true);
  assert.equal(await plan.hasPaidPlan(id, "free"), true);
  assert.equal(await plan.paidUntil(id), Date.parse(end));
  assert.equal(await plan.hasPaidPlan(id, "free", Date.parse(end) + 1), false);
  assert.ok(await dbm.getAffiliate(id), "enrolled as an affiliate");
  // Idempotent, and a shorter claim never shortens the stored pass.
  assert.equal(await plan.recordCoinpayPass(id, claim({ active: true, expires_at: end })), false);
  assert.equal(await plan.recordCoinpayPass(id, claim({ active: true, expires_at: inDays(5) })), false);
  assert.equal(await plan.paidUntil(id), Date.parse(end));
});

test("granted days that run longer than the pass win, and are not used up by it", async () => {
  const id = await dbm.accountIdForCoinpay("pass-sub-2");
  await plan.grantPaidDays(id, 60, "code:test");
  const granted = await plan.paidUntil(id);
  await plan.recordCoinpayPass(id, claim({ active: true, expires_at: inDays(30) }));
  assert.equal(await plan.paidUntil(id), granted);
  assert.equal(plan.laterOf(null, null), null);
  assert.equal(plan.laterOf(5, null), 5);
  assert.equal(plan.laterOf(null, 7), 7);
  assert.equal(plan.laterOf(5, 7), 7);
});
