import assert from "node:assert/strict";
import test from "node:test";

import { isCheckoutSessionId, payUrl, sessionMinutes, isPaidStatus, PROPERTY } from "../lib/coinpay.ts";

test("checkout session ids are told apart from payment ids", () => {
  assert.equal(isCheckoutSessionId("cs_abcDEF1234567890abcdefgh"), true);
  assert.equal(isCheckoutSessionId("4ae63a01-1111-2222-3333-444455556666"), false);
  assert.equal(isCheckoutSessionId(null), false);
});

test("payUrl sends sessions to the hosted checkout and old payments to /pay", () => {
  assert.equal(payUrl("cs_abc123"), "https://coinpayportal.com/checkout/cs_abc123");
  assert.equal(payUrl("pay-1"), "https://coinpayportal.com/pay/pay-1");
});

test("sessionMinutes clamps the claim hold to CoinPay's 15 to 120 minutes", () => {
  assert.equal(sessionMinutes(30), 30);
  assert.equal(sessionMinutes(1), 15);
  assert.equal(sessionMinutes(1440), 120);
});

test("a paid session status counts as paid", () => {
  assert.equal(isPaidStatus("paid"), true);
  assert.equal(isPaidStatus("open"), false);
  assert.equal(isPaidStatus("expired"), false);
  assert.equal(PROPERTY, "moshcoding.com");
});
