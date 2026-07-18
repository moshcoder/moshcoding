import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { signWebhook, verifyWebhook } from "../lib/webhook-signing.ts";

function signature(id, ts, body, secret) {
  return `v1,${crypto.createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

test("webhook verification accepts signed integer timestamps", () => {
  const body = JSON.stringify({ type: "ping" });
  const secret = "whsec_test";
  const ts = Math.floor(Date.now() / 1000);

  assert.equal(verifyWebhook(signWebhook("evt_test", ts, body, secret), body, secret), true);
});

test("webhook verification rejects non-integer timestamp text", () => {
  const body = JSON.stringify({ type: "ping" });
  const secret = "whsec_test";
  const ts = `${Math.floor(Date.now() / 1000)}abc`;
  const headers = {
    "webhook-id": "evt_test",
    "webhook-timestamp": ts,
    "webhook-signature": signature("evt_test", ts, body, secret),
  };

  assert.equal(verifyWebhook(headers, body, secret), false);
});
