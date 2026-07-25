import assert from "node:assert/strict";
import test from "node:test";

import { setupAmountUsd } from "../lib/coinpay.ts";

test("setupAmountUsd accepts ordinary positive dollar amounts", () => {
  assert.equal(setupAmountUsd("1.00"), 1);
  assert.equal(setupAmountUsd(" 1,234.56 "), 1234.56);
  assert.equal(setupAmountUsd(2.345), 2.35);
});

test("setupAmountUsd rejects malformed or unsafe payment amounts", () => {
  assert.throws(() => setupAmountUsd(""), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("1e2"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("0x10"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd("-1"), /positive dollar amount/);
  assert.throws(() => setupAmountUsd(Number.NaN), /positive/);
  assert.throws(() => setupAmountUsd(Number.POSITIVE_INFINITY), /positive/);
});
