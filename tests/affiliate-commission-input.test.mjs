import assert from "node:assert/strict";
import test from "node:test";

import { parseCommissionPercent } from "../lib/affiliate.ts";

test("parseCommissionPercent accepts finite numbers and decimal strings", () => {
  assert.equal(parseCommissionPercent(25), 25);
  assert.equal(parseCommissionPercent("80"), 80);
  assert.equal(parseCommissionPercent(" 12.5 "), 12.5);
});

test("parseCommissionPercent rejects coerced or malformed values", () => {
  assert.equal(parseCommissionPercent("1e2"), null);
  assert.equal(parseCommissionPercent("0x10"), null);
  assert.equal(parseCommissionPercent("80abc"), null);
  assert.equal(parseCommissionPercent(["80"]), null);
  assert.equal(parseCommissionPercent({ valueOf: () => 80 }), null);
  assert.equal(parseCommissionPercent(Number.NaN), null);
  assert.equal(parseCommissionPercent(Number.POSITIVE_INFINITY), null);
});
