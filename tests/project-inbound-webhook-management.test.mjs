import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";

const {
  db,
  deleteProjectInboundWebhook,
  ensureSchema,
  setProjectInboundWebhookActive,
} = await import("../lib/db.ts");

await ensureSchema();

async function insertReceiver(projectId, suffix) {
  const id = `receiver-${suffix}`;
  await db().execute({
    sql: `INSERT INTO inbound_webhooks (id, project_id, provider, secret)
          VALUES (?, ?, ?, ?)`,
    args: [id, projectId, `provider-${suffix}`, `whrcv_${suffix}`],
  });
  return id;
}

test("inbound receivers pause and resume without losing configuration", async () => {
  const id = await insertReceiver("project-pause", "pause");

  assert.equal(await setProjectInboundWebhookActive(id, "project-pause", false), true);
  const paused = await db().execute({
    sql: `SELECT provider, secret, active FROM inbound_webhooks WHERE id = ?`,
    args: [id],
  });
  assert.deepEqual(
    {
      provider: String(paused.rows[0].provider),
      secret: String(paused.rows[0].secret),
      active: Number(paused.rows[0].active),
    },
    { provider: "provider-pause", secret: "whrcv_pause", active: 0 },
  );

  assert.equal(await setProjectInboundWebhookActive(id, "project-pause", true), true);
  const resumed = await db().execute({
    sql: `SELECT active FROM inbound_webhooks WHERE id = ?`,
    args: [id],
  });
  assert.equal(Number(resumed.rows[0].active), 1);
});

test("project scoping prevents cross-project receiver changes", async () => {
  const id = await insertReceiver("project-owner", "scoped");
  await db().execute({
    sql: `INSERT INTO inbound_events
            (id, inbound_id, provider, idempotency_key, status)
          VALUES (?, ?, ?, ?, 'accepted')`,
    args: ["inbound-event-scoped", id, "provider-scoped", "event-scoped"],
  });

  assert.equal(await setProjectInboundWebhookActive(id, "project-other", false), false);
  assert.equal(await deleteProjectInboundWebhook(id, "project-other"), false);

  const receiver = await db().execute({
    sql: `SELECT active FROM inbound_webhooks WHERE id = ?`,
    args: [id],
  });
  assert.equal(Number(receiver.rows[0].active), 1);
  const events = await db().execute({
    sql: `SELECT 1 FROM inbound_events WHERE inbound_id = ?`,
    args: [id],
  });
  assert.equal(events.rows.length, 1);
});

test("deleting an inbound receiver also deletes its event history", async () => {
  const id = await insertReceiver("project-delete", "delete");
  await db().execute({
    sql: `INSERT INTO inbound_events
            (id, inbound_id, provider, idempotency_key, status)
          VALUES (?, ?, ?, ?, 'accepted')`,
    args: ["inbound-event-delete", id, "provider-delete", "event-delete"],
  });

  assert.equal(await deleteProjectInboundWebhook(id, "project-delete"), true);
  assert.equal(await deleteProjectInboundWebhook(id, "project-delete"), false);

  const receivers = await db().execute({
    sql: `SELECT 1 FROM inbound_webhooks WHERE id = ?`,
    args: [id],
  });
  const events = await db().execute({
    sql: `SELECT 1 FROM inbound_events WHERE inbound_id = ?`,
    args: [id],
  });
  assert.equal(receivers.rows.length, 0);
  assert.equal(events.rows.length, 0);
});
