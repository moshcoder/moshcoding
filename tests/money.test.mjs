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

test("dollarsToCents rejects partial dollar amounts passed as numbers", () => {
  // The number path must reject sub-cent precision just like the "$1.234"
  // string case above — otherwise numeric JSON bodies bypass the guard.
  assert.equal(dollarsToCents(1.234), null);
  assert.equal(dollarsToCents(5.005), null);
  assert.equal(dollarsToCents(0.999), null);
  // Whole-cent numbers still parse, including exact two-decimal values.
  assert.equal(dollarsToCents(1), 100);
  assert.equal(dollarsToCents(1.99), 199);
  assert.equal(dollarsToCents(1234.56), 123456);
});
