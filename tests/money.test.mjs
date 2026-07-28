import assert from "node:assert/strict";
import test from "node:test";

import { dollarsToCents } from "../lib/money.ts";

test("dollarsToCents accepts ordinary dollar strings", () => {
  assert.equal(dollarsToCents("1"), 100);
  assert.equal(dollarsToCents("$1.25"), 125);
  assert.equal(dollarsToCents("$1,234.56"), 123456);
  assert.equal(dollarsToCents("  $ 10.50  "), 1050);
});

test("dollarsToCents rejects partial or non-decimal strings", () => {
  assert.equal(dollarsToCents("1abc"), null);
  assert.equal(dollarsToCents("1e2"), null);
  assert.equal(dollarsToCents("0x10"), null);
  assert.equal(dollarsToCents("$1.234"), null);
  assert.equal(dollarsToCents("0"), null);
});

test("dollarsToCents handles numeric values without accepting non-finite numbers", () => {
  assert.equal(dollarsToCents(2.5), 250);
  assert.equal(dollarsToCents(Number.NaN), null);
  assert.equal(dollarsToCents(Number.POSITIVE_INFINITY), null);
});
