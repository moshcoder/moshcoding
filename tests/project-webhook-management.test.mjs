import assert from "node:assert/strict";
import test from "node:test";

// TEST_PG_URL=postgres://... runs the same suite on Postgres (through libsql-pg).
if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL;
else {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_URL;
}

const { db, ensureSchema } = await import("../lib/db.ts");
const wh = await import("../lib/webhooks.ts");

await ensureSchema();

// A hub whose fetch is a recorder and whose DNS check accepts the test hosts.
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

async function create(projectId, suffix, events = ["*"]) {
  const { endpoint, secret } = await wh.createProjectWebhook(projectId, `https://hooks.example.test/${suffix}`, events);
  return { id: endpoint.id, endpoint, secret };
}

test("project webhook targets pause and resume without losing configuration", async () => {
  const { id, secret } = await create("project-pause", "pause");
  calls.length = 0;

  assert.equal(await wh.setProjectWebhookActive(id, "project-pause", false), true);
  assert.equal((await wh.dispatchEvent("project-pause", "build.finished", { ok: true })).queued, 0);

  const [paused] = await wh.listProjectWebhooks("project-pause");
  assert.deepEqual(
    { url: paused.url, events: paused.events, active: paused.active },
    { url: "https://hooks.example.test/pause", events: '["*"]', active: 0 },
  );
  assert.equal((await wh.hooks().secret("project:project-pause", id)).secret, secret);

  assert.equal(await wh.setProjectWebhookActive(id, "project-pause", true), true);
  assert.equal((await wh.dispatchEvent("project-pause", "build.finished", { ok: true })).queued, 1);
  await wh.hooks().drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.example.test/pause");
});

test("test deliveries reach active endpoints regardless of event subscriptions", async () => {
  await create("project-subscription-test", "subscription-test", ["build.finished"]);
  calls.length = 0;

  assert.equal((await wh.dispatchEvent("project-subscription-test", "ping", { ok: true })).queued, 0);
  await wh.hooks().drain();
  assert.equal(calls.length, 0);

  const results = await wh.testProjectWebhooks("project-subscription-test");
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(calls.length, 1);
});

test("app-grammar subscriptions are kept on create", async () => {
  const { endpoint } = await create("project-grammar", "grammar", ["deploy:done", "build.finished"]);
  assert.equal(endpoint.events, '["deploy:done","build.finished"]');
  const [listed] = await wh.listProjectWebhooks("project-grammar");
  assert.equal(listed.events, '["deploy:done","build.finished"]');
});

test("project scoping prevents cross-project changes", async () => {
  const { id } = await create("project-owner", "scoped");

  assert.equal(await wh.setProjectWebhookActive(id, "project-other", false), false);
  assert.equal(await wh.deleteProjectWebhook(id, "project-other"), false);
  assert.equal((await wh.listProjectWebhooks("project-owner"))[0].active, 1);
});

test("deleting a project webhook also deletes its delivery history", async () => {
  const { id } = await create("project-delete", "delete");
  await wh.dispatchEvent("project-delete", "build.failed", {});

  assert.equal(await wh.deleteProjectWebhook(id, "project-delete"), true);
  assert.equal(await wh.deleteProjectWebhook(id, "project-delete"), false);

  const endpoints = await db().execute({ sql: `SELECT 1 FROM hub_webhook_endpoints WHERE id = ?`, args: [id] });
  const deliveries = await db().execute({ sql: `SELECT 1 FROM hub_webhook_deliveries WHERE endpoint_id = ?`, args: [id] });
  assert.equal(endpoints.rows.length, 0);
  assert.equal(deliveries.rows.length, 0);
});
