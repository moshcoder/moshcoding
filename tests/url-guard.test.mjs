import assert from "node:assert/strict";
import test from "node:test";

import { isInternalUrl } from "../lib/url-guard.ts";

test("SSRF guard blocks private IPv6 webhook targets", () => {
  assert.equal(isInternalUrl("http://[::1]/hook"), true);
  assert.equal(isInternalUrl("http://[fe80::1]/hook"), true);
  assert.equal(isInternalUrl("http://[fc00::1]/hook"), true);
  assert.equal(isInternalUrl("http://[fd12:3456::1]/hook"), true);
  assert.equal(isInternalUrl("http://[::ffff:192.168.1.10]/hook"), true);
});

test("SSRF guard blocks internal IPv4 special-use ranges", () => {
  assert.equal(isInternalUrl("http://100.64.0.1/hook"), true);
  assert.equal(isInternalUrl("http://100.127.255.254/hook"), true);
  assert.equal(isInternalUrl("http://198.18.0.1/hook"), true);
  assert.equal(isInternalUrl("http://198.19.255.254/hook"), true);
});

test("SSRF guard allows public IPv6 webhook targets", () => {
  assert.equal(isInternalUrl("https://[2606:4700:4700::1111]/hook"), false);
  assert.equal(isInternalUrl("https://[::ffff:8.8.8.8]/hook"), false);
});
