import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";

const {
  db,
  deleteProjectWebhook,
  ensureSchema,
  setProjectWebhookActive,
} = await import("../lib/db.ts");
const { dispatchEvent } = await import("../lib/webhooks.ts");

await ensureSchema();

async function insertEndpoint(projectId, suffix) {
  const id = `endpoint-${suffix}`;
  await db().execute({
    sql: `INSERT INTO webhook_endpoints (id, project_id, url, secret, events)
          VALUES (?, ?, ?, ?, '["*"]')`,
    args: [id, projectId, `https://hooks.example.test/${suffix}`, `whsec_${suffix}`],
  });
  return id;
}

test("project webhook targets pause and resume without losing configuration", async () => {
  const id = await insertEndpoint("project-pause", "pause");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response(null, { status: 204 });
  };

  try {
    assert.equal(await setProjectWebhookActive(id, "project-pause", false), true);
    await dispatchEvent("project-pause", "build.finished", { ok: true });
    assert.equal(calls.length, 0);

    const paused = await db().execute({
      sql: `SELECT url, secret, events, active FROM webhook_endpoints WHERE id = ?`,
      args: [id],
    });
    assert.deepEqual(
      {
        url: String(paused.rows[0].url),
        secret: String(paused.rows[0].secret),
        events: String(paused.rows[0].events),
        active: Number(paused.rows[0].active),
      },
      {
        url: "https://hooks.example.test/pause",
        secret: "whsec_pause",
        events: '["*"]',
        active: 0,
      },
    );

    assert.equal(await setProjectWebhookActive(id, "project-pause", true), true);
    await dispatchEvent("project-pause", "build.finished", { ok: true });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project scoping prevents cross-project changes", async () => {
  const id = await insertEndpoint("project-owner", "scoped");

  assert.equal(await setProjectWebhookActive(id, "project-other", false), false);
  assert.equal(await deleteProjectWebhook(id, "project-other"), false);

  const endpoint = await db().execute({
    sql: `SELECT active FROM webhook_endpoints WHERE id = ?`,
    args: [id],
  });
  assert.equal(Number(endpoint.rows[0].active), 1);
});

test("deleting a project webhook also deletes its delivery history", async () => {
  const id = await insertEndpoint("project-delete", "delete");
  await db().execute({
    sql: `INSERT INTO webhook_deliveries
            (id, endpoint_id, event_type, payload, idempotency_key, status)
          VALUES (?, ?, ?, ?, ?, 'failed')`,
    args: ["delivery-delete", id, "build.failed", "{}", "event-delete"],
  });

  assert.equal(await deleteProjectWebhook(id, "project-delete"), true);
  assert.equal(await deleteProjectWebhook(id, "project-delete"), false);

  const endpoints = await db().execute({
    sql: `SELECT 1 FROM webhook_endpoints WHERE id = ?`,
    args: [id],
  });
  const deliveries = await db().execute({
    sql: `SELECT 1 FROM webhook_deliveries WHERE endpoint_id = ?`,
    args: [id],
  });
  assert.equal(endpoints.rows.length, 0);
  assert.equal(deliveries.rows.length, 0);
});
