import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";

const { db, ensureSchema, listDomainSignups } = await import("../lib/db.ts");

await ensureSchema();

await db().batch([
  {
    sql: "INSERT INTO signups (email, dn, created_at) VALUES (?, ?, ?)",
    args: ["middle@example.com", "sort.test", "2026-02-01 00:00:00"],
  },
  {
    sql: "INSERT INTO signups (email, dn, created_at) VALUES (?, ?, ?)",
    args: ["zulu@example.com", "sort.test", "2026-01-01 00:00:00"],
  },
  {
    sql: "INSERT INTO signups (email, dn, created_at) VALUES (?, ?, ?)",
    args: ["Alpha@example.com", "sort.test", "2026-03-01 00:00:00"],
  },
]);

test("waitlist sorting happens before the row limit", async () => {
  assert.deepEqual(
    (await listDomainSignups("sort.test", 2, "newest")).map((signup) => signup.email),
    ["Alpha@example.com", "middle@example.com"],
  );
  assert.deepEqual(
    (await listDomainSignups("sort.test", 2, "oldest")).map((signup) => signup.email),
    ["zulu@example.com", "middle@example.com"],
  );
  assert.deepEqual(
    (await listDomainSignups("sort.test", 2, "email")).map((signup) => signup.email),
    ["Alpha@example.com", "middle@example.com"],
  );
});
