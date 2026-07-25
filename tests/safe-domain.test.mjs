import assert from "node:assert/strict";
import test from "node:test";

import { safeDomain } from "../lib/config.ts";

test("safeDomain strips forwarded paths and accepts ordinary domains", () => {
  assert.equal(safeDomain("https://example.com/path?ref=abc"), "example.com");
  assert.equal(safeDomain("Sub.Example.COM#top"), "sub.example.com");
});

test("safeDomain rejects empty labels and edge punctuation", () => {
  assert.equal(safeDomain(".example.com"), null);
  assert.equal(safeDomain("example.com."), null);
  assert.equal(safeDomain("example..com"), null);
  assert.equal(safeDomain("-example.com"), null);
  assert.equal(safeDomain("example-.com"), null);
  assert.equal(safeDomain("example.-com"), null);
  assert.equal(safeDomain("example.com-"), null);
});
