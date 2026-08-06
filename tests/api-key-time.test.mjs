import { test } from "node:test";
import assert from "node:assert/strict";

import { formatApiKeyTime, normalizeApiKeyTimestamp } from "../lib/api-key-time.ts";

test("SQLite API key timestamps are interpreted as UTC", () => {
  assert.equal(
    normalizeApiKeyTimestamp("2026-08-05 12:00:00"),
    "2026-08-05T12:00:00Z",
  );
  assert.equal(
    normalizeApiKeyTimestamp("2026-08-05 12:00:00.123"),
    "2026-08-05T12:00:00.123Z",
  );
});

test("qualified API key timestamps are left unchanged", () => {
  assert.equal(
    normalizeApiKeyTimestamp("2026-08-05T12:00:00Z"),
    "2026-08-05T12:00:00Z",
  );
  assert.equal(
    normalizeApiKeyTimestamp("2026-08-05T12:00:00+02:00"),
    "2026-08-05T12:00:00+02:00",
  );
});

test("missing and invalid API key timestamps remain readable", () => {
  assert.equal(formatApiKeyTime(null), "never");
  assert.equal(formatApiKeyTime("not a timestamp"), "not a timestamp");
});
