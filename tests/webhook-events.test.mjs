import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RELAY_HOPS,
  normalizeInboundEventType,
  parseRelayHop,
  relayEventType,
} from "../lib/webhook-events.ts";

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

test("relayed event types are prefixed exactly once", () => {
  assert.equal(relayEventType("payment.succeeded"), "inbound.payment.succeeded");
  assert.equal(relayEventType(null), "inbound.event");
  assert.equal(relayEventType("payment succeeded"), "inbound.event");

  // A relay that re-enters our own receiver must not grow the prefix chain.
  let type = relayEventType(null);
  for (let i = 0; i < 12; i++) type = relayEventType(type);
  assert.equal(type, "inbound.event");
});

test("relay hop counter clamps to the loop cap", () => {
  assert.equal(parseRelayHop("2"), 2);
  assert.equal(parseRelayHop(null), 0);
  assert.equal(parseRelayHop("not-a-number"), 0);
  assert.equal(parseRelayHop("-3"), 0);
  assert.equal(parseRelayHop("99"), MAX_RELAY_HOPS);
});
