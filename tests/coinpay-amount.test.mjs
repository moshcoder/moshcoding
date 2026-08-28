import assert from "node:assert/strict";
import test from "node:test";

import { setupAmountUsd } from "../lib/coinpay.ts";

test("setupAmountUsd accepts ordinary positive dollar amounts", () => {
  assert.equal(setupAmountUsd("1.00"), 1);
  assert.equal(setupAmountUsd(" 1,234.56 "), 1234.56);
  assert.equal(setupAmountUsd(2.35), 2.35);
});

test("setupAmountUsd rejects numbers finer than a cent", () => {
  assert.throws(() => setupAmountUsd(2.345), /fractional cents/);
  assert.throws(() => setupAmountUsd(1.234), /fractional cents/);
  assert.throws(() => setupAmountUsd(0.004), /fractional cents/);
});

test("setupAmountUsd rejects malformed or unsafe payment amounts", () => {
  assert.throws(() => setupAmountUsd(""), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("1e2"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("0x10"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("-1"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd(Number.NaN), /positive/);
  assert.throws(() => setupAmountUsd(Number.POSITIVE_INFINITY), /positive/);
});

test("claimPriceUsd defaults to the $10 ending price", async () => {
  const { claimPriceUsd, CLAIM_PRICE_USD } = await import("../lib/coinpay.ts");
  assert.equal(CLAIM_PRICE_USD, "10.00");
  assert.equal(claimPriceUsd(), 10);
  assert.equal(claimPriceUsd("25"), 25);
});

test("claimPriceUsd rejects a price that could not be charged honestly", async () => {
  const { claimPriceUsd } = await import("../lib/coinpay.ts");
  assert.throws(() => claimPriceUsd("free"), /positive dollar amount/);
  assert.throws(() => claimPriceUsd("0"), /positive/);
  assert.throws(() => claimPriceUsd("10.001"), /positive dollar amount/);
});

test("formatUsd renders a storable, displayable amount", async () => {
  const { formatUsd } = await import("../lib/coinpay.ts");
  assert.equal(formatUsd(10), "10.00");
  assert.equal(formatUsd(9.5), "9.50");
});
