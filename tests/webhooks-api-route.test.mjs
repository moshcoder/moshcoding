import assert from "node:assert/strict";
import test from "node:test";

// TEST_PG_URL=postgres://... runs the same suite on Postgres (through libsql-pg).
if (process.env.TEST_PG_URL) process.env.DATABASE_URL = process.env.TEST_PG_URL;
else {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_URL;
}
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const route = await import("../app/api/v1/webhooks/[[...path]]/route.ts");
const { createApiKey } = await import("../lib/apikeys.ts");
const { db, ensureSchema } = await import("../lib/db.ts");
const wh = await import("../lib/webhooks.ts");

await ensureSchema();
wh.setHooksForTests(wh.createHooks({ fetchImpl: async () => new Response(null, { status: 204 }), guard: { lookup: async () => ["93.184.216.34"] } }));

const req = (path, init = {}) => new NextRequest(new URL(path, "https://moshcoding.com"), init);

test("/api/v1/webhooks answers 401 without a key", async () => {
  const r = await route.GET(req("/api/v1/webhooks?dn=example.test"));
  assert.equal(r.status, 401);
});

test("an API key manages the targets of a domain its account owns, and only those", async () => {
  await db().execute({ sql: `INSERT INTO accounts (id, email, password_hash, password_salt, domain) VALUES (?, ?, ?, ?, ?)`, args: ["acct-api", "api@example.test", "x", "x", "mine.test"] });
  const { token } = await createApiKey("acct-api", "test");
  const auth = { authorization: `Bearer ${token}` };

  assert.equal((await route.GET(req("/api/v1/webhooks?dn=theirs.test", { headers: auth }))).status, 403);
  assert.equal((await route.GET(req("/api/v1/webhooks", { headers: auth }))).status, 400);

  const created = await route.POST(req("/api/v1/webhooks?dn=mine.test", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://hooks.example.test/api", events: ["bid.*"] }),
  }));
  assert.equal(created.status, 201);
  const { endpoint, secret } = await created.json();
  assert.match(secret, /^whsec_/);

  const list = await (await route.GET(req("/api/v1/webhooks?dn=mine.test", { headers: auth }))).json();
  assert.deepEqual(list.endpoints.map((e) => e.id), [endpoint.id]);
  assert.ok(list.event_types.includes("bid.placed"));

  const tested = await route.POST(req(`/api/v1/webhooks/${endpoint.id}/test?dn=mine.test`, { method: "POST", headers: auth }));
  assert.equal((await tested.json()).ok, true);

  // The same target is invisible through a domain the key does not own.
  assert.equal((await route.GET(req(`/api/v1/webhooks/${endpoint.id}?dn=theirs.test`, { headers: auth }))).status, 403);
});
