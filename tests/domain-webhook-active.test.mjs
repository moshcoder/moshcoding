import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";

const {
  activeDomainWebhooks,
  addDomainWebhook,
  listDomainWebhooks,
  setDomainWebhookActive,
} = await import("../lib/db.ts");

test("domain webhook targets can pause and resume without losing their configuration", async () => {
  const webhook = await addDomainWebhook("example.test", "https://hooks.example.test/events", "whsec_keep_me");

  assert.equal(webhook.active, true);
  assert.deepEqual(await activeDomainWebhooks("example.test"), [
    { url: "https://hooks.example.test/events", secret: "whsec_keep_me" },
  ]);

  assert.equal(await setDomainWebhookActive(webhook.id, "example.test", false), true);
  assert.deepEqual(await activeDomainWebhooks("example.test"), []);
  assert.deepEqual(
    (await listDomainWebhooks("example.test")).map(({ url, secret, active }) => ({ url, secret, active })),
    [{ url: "https://hooks.example.test/events", secret: "whsec_keep_me", active: false }],
  );

  assert.equal(await setDomainWebhookActive(webhook.id, "example.test", true), true);
  assert.deepEqual(await activeDomainWebhooks("example.test"), [
    { url: "https://hooks.example.test/events", secret: "whsec_keep_me" },
  ]);
});

test("a target cannot be changed through another domain", async () => {
  const webhook = await addDomainWebhook("owner.test", "https://hooks.example.test/owner", "whsec_owner");

  assert.equal(await setDomainWebhookActive(webhook.id, "other.test", false), false);
  assert.equal((await listDomainWebhooks("owner.test"))[0].active, true);
});
