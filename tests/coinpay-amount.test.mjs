import assert from "node:assert/strict";
import test from "node:test";

import { claimPriceUsd, formatUsd, CLAIM_PRICE_USD } from "../lib/coinpay.ts";

test("claimPriceUsd accepts ordinary positive dollar amounts", () => {
  assert.equal(claimPriceUsd("1.00"), 1);
  assert.equal(claimPriceUsd(" 1,234.56 "), 1234.56);
  assert.equal(claimPriceUsd(2.35), 2.35);
});

test("claimPriceUsd defaults to the $10 ending price", () => {
  assert.equal(CLAIM_PRICE_USD, "10.00");
  assert.equal(claimPriceUsd(), 10);
  assert.equal(claimPriceUsd("25"), 25);
});

test("claimPriceUsd rejects numbers finer than a cent", () => {
  assert.throws(() => claimPriceUsd(2.345), /fractional cents/);
  assert.throws(() => claimPriceUsd(1.234), /fractional cents/);
  assert.throws(() => claimPriceUsd(0.004), /fractional cents/);
  assert.throws(() => claimPriceUsd("10.001"), /positive dollar amount/);
});

test("claimPriceUsd rejects malformed or unsafe payment amounts", () => {
  assert.throws(() => claimPriceUsd(""), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("free"), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("1e2"), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("0x10"), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("-1"), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("0"), /positive/);
  assert.throws(() => claimPriceUsd(Number.NaN), /positive/);
  assert.throws(() => claimPriceUsd(Number.POSITIVE_INFINITY), /positive/);
});

test("formatUsd renders a storable, displayable amount", () => {
  assert.equal(formatUsd(10), "10.00");
  assert.equal(formatUsd(9.5), "9.50");
});
