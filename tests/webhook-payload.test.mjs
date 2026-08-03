import assert from "node:assert/strict";
import test from "node:test";

import { formatStoredWebhookPayload } from "../lib/webhook-payload.ts";

test("stored JSON webhook payloads are formatted for inspection and copying", () => {
  assert.equal(
    formatStoredWebhookPayload('{"event":"payment.succeeded","data":{"amount":100,"paid":true}}'),
    `{
  "event": "payment.succeeded",
  "data": {
    "amount": 100,
    "paid": true
  }
}`,
  );
});

test("non-JSON webhook payloads fall back to the stored body verbatim", () => {
  const raw = "payment.succeeded\namount=100&paid=true";
  assert.equal(formatStoredWebhookPayload(raw), raw);
  assert.equal(formatStoredWebhookPayload(""), "");
});

test("JSON formatting preserves number literals exactly", () => {
  const raw = '{"id":9007199254740993,"ratio":0.1234567890123456789,"empty":[]}';
  const formatted = formatStoredWebhookPayload(raw);

  assert.match(formatted, /9007199254740993/);
  assert.match(formatted, /0\.1234567890123456789/);
  assert.equal(formatted, `{
  "id": 9007199254740993,
  "ratio": 0.1234567890123456789,
  "empty": []
}`);
});

test("JSON formatting preserves escaped strings and duplicate keys", () => {
  const raw = '{"text":"comma, colon: braces {} [\\"quoted\\"]","key":1,"key":2}';

  assert.equal(formatStoredWebhookPayload(raw), `{
  "text": "comma, colon: braces {} [\\"quoted\\"]",
  "key": 1,
  "key": 2
}`);
});

test("deep JSON falls back to raw text instead of amplifying indentation", () => {
  const raw = `${"[".repeat(2000)}0${"]".repeat(2000)}`;
  const formatted = formatStoredWebhookPayload(raw);

  assert.equal(formatted, raw);
  assert.equal(formatted.length, 4001);
});
