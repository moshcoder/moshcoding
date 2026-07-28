import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInboundEventType } from "../lib/webhook-events.ts";

test("inbound webhook event types accept compact event names", () => {
  assert.equal(normalizeInboundEventType(" payment.succeeded "), "payment.succeeded");
  assert.equal(normalizeInboundEventType("order_created"), "order_created");
  assert.equal(normalizeInboundEventType("provider:event-v1"), "provider:event-v1");
});

test("inbound webhook event types reject non-string and unsafe values", () => {
  assert.equal(normalizeInboundEventType({ type: "payment.succeeded" }), null);
  assert.equal(normalizeInboundEventType(["payment.succeeded"]), null);
  assert.equal(normalizeInboundEventType(""), null);
  assert.equal(normalizeInboundEventType(".hidden"), null);
  assert.equal(normalizeInboundEventType("payment succeeded"), null);
  assert.equal(normalizeInboundEventType("x".repeat(81)), null);
});
