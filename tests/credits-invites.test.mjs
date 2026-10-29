import assert from "node:assert/strict";
import test from "node:test";

// TEST_PG_URL=postgres://... runs the same suite on Postgres (through libsql-pg).
if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL;
else {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_URL;
}
delete process.env.RESEND_API_KEY;
process.env.SESSION_SECRET = "test-secret";
process.env.ADMIN_EMAILS = "boss@example.com";

const dbm = await import("../lib/db.ts");
const plan = await import("../lib/plan.ts");
const cr = await import("../lib/credits.ts");
const { sqlTime } = await import("../lib/sql-time.ts");
const { db, ensureSchema } = dbm;
await ensureSchema();

const DAY = 86_400_000;
let n = 0;
async function account(email, { ageDays = 0, password = true } = {}) {
  const a = password
    ? await dbm.createAccount({ email, passwordHash: "x", passwordSalt: "y" })
    : await dbm.findOrCreateAccountByEmail(email);
  await db().execute({ sql: `UPDATE accounts SET created_at = ? WHERE id = ?`, args: [sqlTime(new Date(Date.now() - ageDays * DAY)), a.id] });
  return dbm.getAccountById(a.id);
}
const uniq = (p) => `${p}${++n}@example.com`;

test("granted days queue after each other", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const until = plan.paidUntilFromGrants([
    { days: 10, granted_at: "2026-01-01 00:00:00" },
    { days: 5, granted_at: "2026-01-03 00:00:00" },
  ]);
  assert.equal(until, t0 + 15 * DAY);
  assert.equal(plan.paidUntilFromGrants([]), null);
});

test("a code grants paid-plan days once per account", async () => {
  const a = await account(uniq("redeem"));
  const b = await account(uniq("redeem"));
  const { code } = await cr.credits().mint({ grant: { unit: "pro_days", amount: 30 }, maxRedemptions: 2, prefix: "MOSH" });
  assert.equal(await plan.hasPaidPlan(a.id, "free"), false);
  assert.deepEqual(await cr.redeemCode(code.toLowerCase(), a.id), { ok: true, days: 30 });
  assert.equal(await plan.hasPaidPlan(a.id, "free"), true);
  const until = await plan.paidUntil(a.id);
  assert.ok(until > Date.now() + 29 * DAY && until < Date.now() + 31 * DAY);
  assert.deepEqual(await cr.redeemCode(code, a.id), { ok: false, reason: "already_redeemed" });
  assert.equal((await plan.paidUntil(a.id)), until, "a second redeem adds nothing");
  assert.equal((await cr.redeemCode(code, b.id)).ok, true);
  const c = await account(uniq("redeem"));
  assert.deepEqual(await cr.redeemCode(code, c.id), { ok: false, reason: "used_up" });
  assert.deepEqual(await cr.redeemCode("MOSH-0000-0000-0000-0000", c.id), { ok: false, reason: "invalid" });
  // the code enrolled the account in the affiliate program it unlocks
  assert.ok(await dbm.getAffiliate(a.id));
});

test("a lost mirror write is repaired on the next attempt", async () => {
  const a = await account(uniq("repair"));
  const { code, id } = await cr.credits().mint({ grant: { unit: "pro_days", amount: 7 } });
  await cr.redeemCode(code, a.id);
  await db().execute({ sql: `DELETE FROM plan_grants WHERE account_id = ?`, args: [a.id] });
  assert.equal(await plan.paidUntil(a.id), null);
  assert.equal((await cr.redeemCode(code, a.id)).reason, "already_redeemed");
  const g = await db().execute({ sql: `SELECT source, days FROM plan_grants WHERE account_id = ?`, args: [a.id] });
  assert.deepEqual(g.rows.map((r) => [r.source, Number(r.days)]), [[`code:${id}`, 7]]);
});

test("ADMIN_EMAILS never grants admin from an unverified email", async () => {
  const native = await account("boss@example.com");
  const again = await dbm.findOrCreateAccountByEmail("boss@example.com");
  assert.equal(again.id, native.id);
  assert.equal(again.is_admin, false);
  const other = await dbm.accountIdForCoinpay("sub-attacker", "boss@example.com");
  assert.notEqual(other, native.id, "a CoinPay sign-in cannot take a password account");
});

test("a CoinPay sign-in is bound by sub, not matched by email", async () => {
  const email = uniq("cp");
  const id = await dbm.accountIdForCoinpay("sub-1", email);
  assert.ok(id);
  assert.equal(await dbm.accountIdForCoinpay("sub-1", email), id);
  assert.equal(await dbm.accountIdForCoinpay("sub-1", "changed@example.com"), id, "bound sub wins over email");
  const id2 = await dbm.accountIdForCoinpay("sub-2", email);
  assert.ok(id2 && id2 !== id, "another CoinPay identity with the same email gets its own account");
  // an email-only affiliate account (no password, unbound) is NOT claimed by email
  const joined = await dbm.findOrCreateAccountByEmail(uniq("join"));
  const id3 = await dbm.accountIdForCoinpay("sub-3", joined.email);
  assert.notEqual(id3, joined.id);
  assert.equal((await dbm.getAccountById(joined.id)).coinpay_sub, null);
  assert.equal(await dbm.accountIdForCoinpay("acct:whatever", joined.email), null);
});

test("invites: senders need an account a day old", async () => {
  const fresh = await account(uniq("new"));
  assert.equal((await cr.canSendInvites(fresh)).ok, false);
  const old = await account(uniq("old"), { ageDays: 2 });
  assert.equal((await cr.canSendInvites(old)).ok, true);
});

test("concurrent accepts: one invite wins, the other is refused and stays unused", async () => {
  const alice = await account(uniq("alice"), { ageDays: 3 });
  const bob = await account(uniq("bob"), { ageDays: 3 });
  const carol = await account(`carol${++n}@othermail.example`);
  const ia = await cr.affiliates().createInvite(alice.id);
  const ib = await cr.affiliates().createInvite(bob.id);
  const [ra, rb] = await Promise.all([cr.acceptInvite(ia.code, carol.id), cr.acceptInvite(ib.code, carol.id)]);
  const results = [ra, rb];
  assert.equal(results.filter((r) => r.ok).length, 1);
  const lost = results.find((r) => !r.ok);
  assert.equal(lost.reason, "already_invited");
  const won = results.find((r) => r.ok);
  assert.equal(won.status, "pending");
  const loser = won.inviterId === alice.id ? bob : alice;
  const loserInvites = await cr.affiliates().invites(loser.id);
  assert.equal(loserInvites[0].usedBy, null, "the refused invite stays unused");

  // the bonus waits for the email confirmation, then pays both sides once
  assert.equal(await plan.paidUntil(carol.id), null);
  const token = cr.confirmToken(carol.id, carol.email);
  const c1 = await cr.confirmInvite(token);
  assert.equal(c1.ok, true);
  assert.equal(c1.inviterPaid, true);
  assert.ok((await plan.paidUntil(carol.id)) > Date.now() + 29 * DAY);
  assert.ok((await plan.paidUntil(won.inviterId)) > Date.now() + 29 * DAY);
  assert.deepEqual(await cr.confirmInvite(token), { ok: false, reason: "nothing_pending" });
  assert.deepEqual(await cr.confirmInvite(token + "x"), { ok: false, reason: "bad_link" });
  assert.equal(await plan.paidUntil(loser.id), null);
});

test("invites: too-old accounts are refused without spending the invite", async () => {
  const alice = await account(uniq("al"), { ageDays: 3 });
  const oldie = await account(uniq("oldie"), { ageDays: 30 });
  const inv = await cr.affiliates().createInvite(alice.id);
  assert.deepEqual(await cr.acceptInvite(inv.code, oldie.id), { ok: false, reason: "too_old" });
  assert.equal((await cr.affiliates().invites(alice.id))[0].usedBy, null);
});

test("invites: same mailbox and throwaway domains get no bonus", async () => {
  const alice = await account(`al.ice${++n}@gmail.com`, { ageDays: 3 });
  const alias = await account(alice.email.replace("@", "+x@").replace("al.ice", "alice"));
  const inv = await cr.affiliates().createInvite(alice.id);
  const r = await cr.acceptInvite(inv.code, alias.id);
  assert.deepEqual([r.ok, r.status, r.reason], [true, "denied", "same_mailbox"]);
  assert.equal((await cr.confirmInvite(cr.confirmToken(alias.id, alias.email))).reason, "nothing_pending");

  const trash = await account(`t${++n}@mailinator.com`);
  const inv2 = await cr.affiliates().createInvite(alice.id);
  const r2 = await cr.acceptInvite(inv2.code, trash.id);
  assert.equal(r2.reason, "throwaway_email");
  assert.equal(cr.mailboxKey("A.B+tag@GoogleMail.com"), "ab@gmail.com");
});

test("invites: the inviter's half stops at the monthly cap", async () => {
  process.env.INVITE_MONTHLY_CAP = "1";
  try {
    const alice = await account(uniq("cap"), { ageDays: 3 });
    await cr.affiliates().setQuota(alice.id, 5);
    const paid = [];
    for (let i = 0; i < 2; i++) {
      const who = await account(`cap-invitee${++n}@othermail.example`);
      const inv = await cr.affiliates().createInvite(alice.id);
      assert.equal((await cr.acceptInvite(inv.code, who.id)).status, "pending");
      const c = await cr.confirmInvite(cr.confirmToken(who.id, who.email));
      paid.push(c.inviterPaid);
      assert.ok((await plan.paidUntil(who.id)) > Date.now(), "the invitee is always paid");
    }
    assert.deepEqual(paid, [true, false]);
  } finally {
    delete process.env.INVITE_MONTHLY_CAP;
  }
});

test("a claimed domain cannot be taken over by another account", async () => {
  const owner = await account(uniq("owner"));
  const thief = await account(uniq("thief"));
  const dn = `owned-${++n}.example`;
  assert.equal(await dbm.addParkedDomain(owner.id, dn), true);
  assert.equal(await dbm.upsertTenant(dn, owner.id, { headline: "mine" }), true);
  assert.equal(await dbm.addParkedDomain(thief.id, dn), false);
  assert.equal(await dbm.ownsParkedDomain(thief.id, dn), false);
  assert.equal(await dbm.upsertTenant(dn, thief.id, { headline: "pwned" }), false);
  assert.deepEqual(await dbm.getTenantConfig(dn), { headline: "mine" });
  await assert.rejects(dbm.setAccountDomain(thief.id, dn), { name: "DomainTakenError" });
  await assert.rejects(
    dbm.createAccount({ email: uniq("signup"), passwordHash: "x", passwordSalt: "y", domain: dn }),
    { name: "DomainTakenError" },
  );
  // a staff-managed page (no owner) is not claimable either
  const staff = `staff-${++n}.example`;
  assert.equal(await dbm.upsertTenant(staff, null, { headline: "staff" }), true);
  assert.equal(await dbm.addParkedDomain(thief.id, staff), false);
  assert.equal(await dbm.upsertTenant(staff, thief.id, { headline: "pwned" }), false);
  // the owner keeps editing their own page
  assert.equal(await dbm.upsertTenant(dn, owner.id, { headline: "still mine" }), true);
  assert.equal(await dbm.addParkedDomain(owner.id, dn), true);
});
