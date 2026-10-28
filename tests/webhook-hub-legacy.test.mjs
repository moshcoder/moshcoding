import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifySignature } from "@profullstack/webhooks";

// TEST_PG_URL=postgres://... runs the same suite on Postgres (through libsql-pg).
if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL;
else {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_URL;
}

const { db, ensureSchema, migrateLegacyWebhooks } = await import("../lib/db.ts");
const wh = await import("../lib/webhooks.ts");
const { verifyWebhook } = await import("../lib/webhook-signing.ts");
const { legacySecretToSpec } = await import("../lib/webhook-legacy.ts");

await ensureSchema();

const calls = [];
wh.setHooksForTests(
  wh.createHooks({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    },
    guard: { lookup: async () => ["93.184.216.34"] },
  }),
);

// Exactly what a receiver written against the pre-hub sender does: HMAC-SHA256
// keyed with the whole secret string over "<id>.<ts>.<body>", base64, "v1,".
function oldReceiverVerifies(headers, body, secret) {
  const expected = `v1,${crypto.createHmac("sha256", secret).update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`).digest("base64")}`;
  return String(headers["webhook-signature"]).split(" ").includes(expected);
}

test("pre-hub endpoints are copied once, keep their ids, and old receivers still verify", async () => {
  const oldProjectSecret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  const oldDomainSecret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  await db().execute({
    sql: `INSERT INTO webhook_endpoints (id, project_id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, 1, '2026-07-10 01:52:32')`,
    args: ["legacyproj1", "p-legacy", "https://hooks.example.test/legacy-project", oldProjectSecret, '["build.finished"]'],
  });
  await db().execute({
    sql: `INSERT INTO domain_webhooks (id, dn, url, secret, active) VALUES (?, ?, ?, ?, 1)`,
    args: ["legacydom1", "legacy.test", "https://hooks.example.test/legacy-domain", oldDomainSecret],
  });
  await db().execute({
    sql: `INSERT INTO domain_webhooks (id, dn, url, secret, active) VALUES (?, ?, ?, ?, 0)`,
    args: ["legacydom2", "legacy.test", "https://hooks.example.test/legacy-paused", "whsec_paused"],
  });

  assert.equal(await migrateLegacyWebhooks(), 3);
  assert.equal(await migrateLegacyWebhooks(), 0, "a second run copies nothing");

  const project = await wh.listProjectWebhooks("p-legacy");
  assert.deepEqual(project.map(({ id, events, active }) => ({ id, events, active })), [
    { id: "legacyproj1", events: '["build.finished"]', active: 1 },
  ]);
  assert.equal(project[0].created_at, "2026-07-10T01:52:32.000Z");
  const domain = await wh.listDomainWebhooks("legacy.test");
  assert.deepEqual(domain.map(({ id, active }) => ({ id, active })), [
    { id: "legacydom1", active: true },
    { id: "legacydom2", active: false },
  ]);

  // A domain event to the migrated target: the old receiver, holding the old
  // secret, verifies it; so does any Standard Webhooks library with the shown one.
  calls.length = 0;
  await wh.fireDomainEvent("legacy.test", "waitlist.signup", { email: "x@y.test", dn: "legacy.test" });
  await wh.dispatchEvent("p-legacy", "build.finished", { ok: true });
  await wh.hooks().drain();
  assert.equal(calls.length, 2);
  for (const c of calls) {
    const old = c.url.endsWith("legacy-domain") ? oldDomainSecret : oldProjectSecret;
    assert.equal(oldReceiverVerifies(c.init.headers, c.init.body, old), true, `old receiver verifies ${c.url}`);
    assert.equal(verifyWebhook(c.init.headers, c.init.body, old), true, "the app's own old verifier agrees");
    assert.equal(verifySignature({ headers: c.init.headers, body: c.init.body, secret: legacySecretToSpec(old) }).ok, true);
  }
  assert.equal(domain[0].secret, legacySecretToSpec(oldDomainSecret));
});

test("a target deleted after the copy is not copied back", async () => {
  await db().execute({
    sql: `INSERT INTO domain_webhooks (id, dn, url, secret, active) VALUES (?, ?, ?, ?, 1)`,
    args: ["legacydom3", "gone.test", "https://hooks.example.test/gone", "whsec_gone"],
  });
  await migrateLegacyWebhooks();
  assert.equal(await wh.deleteDomainWebhook("legacydom3", "gone.test"), true);
  await migrateLegacyWebhooks();
  assert.deepEqual(await wh.listDomainWebhooks("gone.test"), []);
});

test("a failed delivery is retried later, then delivered", async () => {
  let fail = true;
  const sent = [];
  let now = Date.now();
  const h = new (await import("@profullstack/webhooks")).Webhooks({
    store: (await import("../lib/webhook-store.ts")).libsqlStore(db, ensureSchema),
    fetchImpl: async (url) => { sent.push(String(url)); return new Response(null, { status: fail ? 503 : 200 }); },
    guard: { lookup: async () => ["93.184.216.34"] },
    now: () => now,
  });
  const { endpoint } = await h.createEndpoint("dn:retry.test", { url: "https://hooks.example.test/retry" });
  await h.emit("dn:retry.test", "bid.placed", { n: 1 });
  await h.drain();
  let [d] = await h.deliveries("dn:retry.test");
  assert.equal(d.status, "pending");
  assert.equal(d.attempts, 1);
  assert.equal(d.last_status, 503);

  fail = false;
  await h.drain();
  assert.equal(sent.length, 1, "not due yet");
  now += 31_000;
  await h.drain();
  [d] = await h.deliveries("dn:retry.test");
  assert.equal(d.status, "delivered");
  assert.equal(d.attempts, 2);
  assert.equal((await h.getEndpoint("dn:retry.test", endpoint.id)).failures, 0);
});
