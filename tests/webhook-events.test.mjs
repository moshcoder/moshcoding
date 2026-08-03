import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RELAY_HOPS,
  normalizeInboundEventType,
  normalizeWebhookEventSubscriptions,
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

test("outbound subscriptions trim and deduplicate event names", () => {
  assert.deepEqual(
    normalizeWebhookEventSubscriptions([
      " build.finished ",
      "deploy.failed",
      "build.finished",
      "",
    ]),
    ["build.finished", "deploy.failed"],
  );
});

test("blank outbound subscriptions mean all events", () => {
  for (const value of [undefined, null, [], [""], ["  ", ""]]) {
    assert.deepEqual(normalizeWebhookEventSubscriptions(value), ["*"]);
  }
  assert.deepEqual(
    normalizeWebhookEventSubscriptions(["build.finished", "*", "deploy.failed", "*"]),
    ["*"],
  );
});

test("outbound subscriptions reject malformed arrays and event names", () => {
  for (const value of [
    "build.finished",
    { event: "build.finished" },
    ["build finished"],
    [".hidden"],
    ["x".repeat(81)],
    ["build.finished", 42],
    ["*", "not valid"],
  ]) {
    assert.equal(normalizeWebhookEventSubscriptions(value), null);
  }
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
