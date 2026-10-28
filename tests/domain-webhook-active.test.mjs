import assert from "node:assert/strict";
import test from "node:test";

// TEST_PG_URL=postgres://... runs the same suite on Postgres (through libsql-pg).
if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL;
else {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_URL;
}

const wh = await import("../lib/webhooks.ts");
const { isKnownDomain } = await import("../lib/db.ts");

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

const active = async (dn) => (await wh.listDomainWebhooks(dn)).filter((w) => w.active).map(({ url, secret }) => ({ url, secret }));

test("domain webhook targets can pause and resume without losing their configuration", async () => {
  const webhook = await wh.addDomainWebhook("example.test", "https://hooks.example.test/events");
  assert.equal(webhook.active, true);
  assert.match(webhook.secret, /^whsec_/);
  const keep = { url: "https://hooks.example.test/events", secret: webhook.secret };

  assert.deepEqual(await active("example.test"), [keep]);
  assert.equal(await isKnownDomain("example.test"), true);

  assert.equal(await wh.setDomainWebhookActive(webhook.id, "example.test", false), true);
  assert.deepEqual(await active("example.test"), []);
  assert.deepEqual(
    (await wh.listDomainWebhooks("example.test")).map(({ url, secret, active }) => ({ url, secret, active })),
    [{ ...keep, active: false }],
  );

  assert.equal(await wh.setDomainWebhookActive(webhook.id, "example.test", true), true);
  assert.deepEqual(await active("example.test"), [keep]);
});

test("a target cannot be changed through another domain", async () => {
  const webhook = await wh.addDomainWebhook("owner.test", "https://hooks.example.test/owner");

  assert.equal(await wh.setDomainWebhookActive(webhook.id, "other.test", false), false);
  assert.equal(await wh.deleteDomainWebhook(webhook.id, "other.test"), false);
  assert.equal(await wh.rotateDomainWebhookSecret(webhook.id, "other.test"), null);
  assert.equal((await wh.listDomainWebhooks("owner.test"))[0].active, true);
});

test("domain events are queued, delivered as signed CloudEvents, and filtered by subscription", async () => {
  const all = await wh.addDomainWebhook("events.test", "https://hooks.example.test/all");
  const bids = await wh.addDomainWebhook("events.test", "https://hooks.example.test/bids", "bid.*");
  calls.length = 0;

  await wh.fireDomainEvent("events.test", "waitlist.signup", { email: "a@b.test", dn: "events.test" });
  await wh.fireDomainEvent("events.test", "bid.placed", { dn: "events.test", amountCents: 500 });
  await wh.hooks().drain();

  const to = (u) => calls.filter((c) => c.url === u).map((c) => JSON.parse(c.init.body).type);
  assert.deepEqual(to("https://hooks.example.test/all"), ["waitlist.signup", "bid.placed"]);
  assert.deepEqual(to("https://hooks.example.test/bids"), ["bid.placed"]);

  const first = calls[0];
  const body = JSON.parse(first.init.body);
  assert.equal(body.specversion, "1.0");
  assert.equal(body.subject, "events.test");
  assert.equal(first.init.headers["x-moshcoding-hop"], "1");
  assert.match(first.init.headers["webhook-signature"], /^v1,/);

  const log = await wh.domainDeliveries("events.test");
  assert.equal(log.length, 3);
  assert.ok(log.every((d) => d.status === "delivered"));
  assert.ok(all.id && bids.id);
});

test("a relayed inbound event carries its hop count", async () => {
  await wh.addDomainWebhook("relay.test", "https://hooks.example.test/relay");
  calls.length = 0;
  await wh.fireDomainEvent("relay.test", "inbound.push", { body: "{}" }, { hop: 1 });
  await wh.hooks().drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-moshcoding-hop"], "2");
  assert.equal(JSON.parse(calls[0].init.body).data.relay_hop, 2);
});

test("rotating a secret returns a new one", async () => {
  const webhook = await wh.addDomainWebhook("rotate.test", "https://hooks.example.test/rotate");
  const next = await wh.rotateDomainWebhookSecret(webhook.id, "rotate.test");
  assert.ok(next && next !== webhook.secret);
  assert.equal((await wh.listDomainWebhooks("rotate.test"))[0].secret, next);
});

test("deliveries to our own inbound receiver are refused", async () => {
  // The default hub (no fetchImpl override) blocks self-referential URLs at send time.
  const h = wh.createHooks({ guard: { lookup: async () => ["93.184.216.34"] } });
  const { endpoint } = await h.createEndpoint("dn:self.test", { url: "https://moshcoding.com/api/webhooks/self.test" });
  const r = await h.test("dn:self.test", endpoint.id);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /self-referential/);
});

test("an unknown event pattern is refused", async () => {
  await assert.rejects(() => wh.addDomainWebhook("bad.test", "https://hooks.example.test/x", "nope.thing"), /no event matches/);
});
