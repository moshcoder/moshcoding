import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAffiliateCommission } from "../lib/db.ts";

test("affiliate commission normalizer clamps paid plan percentages", () => {
  assert.equal(normalizeAffiliateCommission(0, "paid"), 1);
  assert.equal(normalizeAffiliateCommission(25.6, "paid"), 26);
  assert.equal(normalizeAffiliateCommission(150, "paid"), 100);
});

test("affiliate commission normalizer enforces the free plan floor", () => {
  assert.equal(normalizeAffiliateCommission(1, "free"), 80);
  assert.equal(normalizeAffiliateCommission(90, "free"), 90);
});

test("affiliate commission normalizer rejects non-finite values safely", () => {
  assert.equal(normalizeAffiliateCommission(Number.NaN, "paid"), 80);
  assert.equal(normalizeAffiliateCommission(Number.POSITIVE_INFINITY, "paid"), 80);
  assert.equal(normalizeAffiliateCommission(Number.NEGATIVE_INFINITY, "free"), 80);
});
