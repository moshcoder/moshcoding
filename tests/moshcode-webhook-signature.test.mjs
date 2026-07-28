import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { verifyMoshcodeSignature } from "../lib/moshcode-webhook-signing.ts";

function signature(ts, body, secret = "test-secret") {
  const v1 = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

test("moshcode webhook signature verifier rejects decimal timestamps", () => {
  process.env.MOSHCODE_WEBHOOK_SECRET = "test-secret";
  process.env.NODE_ENV = "production";
  const body = JSON.stringify({ type: "ping" });
  const now = Math.floor(Date.now() / 1000);

  assert.equal(verifyMoshcodeSignature(body, signature(String(now), body)), true);
  assert.equal(verifyMoshcodeSignature(body, signature(`${now}.5`, body)), false);
});
