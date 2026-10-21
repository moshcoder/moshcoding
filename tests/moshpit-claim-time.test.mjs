import assert from "node:assert/strict";
import test from "node:test";

const { sqlTime } = await import("../lib/moshpit-claims.ts");

test("sqlTime writes SQLite datetime() text form in UTC, so TEXT compares work on Postgres too", () => {
  assert.equal(sqlTime(new Date("2026-10-21T13:05:09.123Z")), "2026-10-21 13:05:09");
  assert.ok(sqlTime(new Date("2026-10-21T09:00:00Z")) < sqlTime(new Date("2026-10-21T10:00:00Z")));
});
