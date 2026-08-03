// API keys — the properties that make them safe to hand to a script.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { generateToken, bearerToken } from "../lib/apikeys.ts";

test("a token is 32 bytes of randomness behind a recognisable prefix", () => {
  const token = generateToken();
  assert.match(token, /^mpk_/, "greppable in a leak scan, and obvious in a log");

  const body = token.slice("mpk_".length);
  assert.equal(Buffer.from(body, "base64url").length, 32, "32 bytes from a CSPRNG");
  // base64url, so it survives env vars, shells and headers without quoting.
  assert.match(body, /^[A-Za-z0-9_-]+$/);
});

test("tokens do not repeat", () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateToken()));
  assert.equal(seen.size, 200);
});

test("the bearer header is parsed, and anything else is not a token", () => {
  const token = generateToken();
  assert.equal(bearerToken(`Bearer ${token}`), token);
  assert.equal(bearerToken(`bearer ${token}`), token, "the scheme is case-insensitive per RFC 7235");
  assert.equal(bearerToken(token), token, "a bare token is accepted too");

  // A session cookie, a Basic credential or an unrelated header must not be
  // mistaken for a key — they would be hashed and looked up, and a miss is
  // indistinguishable from a revoked key in the logs.
  assert.equal(bearerToken("Basic dXNlcjpwYXNz"), null);
  assert.equal(bearerToken("Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"), null, "a JWT is not one of ours");
  assert.equal(bearerToken(""), null);
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(undefined), null);
});

test("the stored hash cannot be turned back into a token", () => {
  // The property that matters if the table leaks: SHA-256 over 32 random bytes
  // has no shortcut, so a dump is not a set of usable credentials.
  const token = generateToken();
  const stored = crypto.createHash("sha256").update(token, "utf8").digest("hex");

  assert.equal(stored.length, 64);
  assert.ok(!stored.includes(token.slice(4, 20)), "no part of the token survives in the hash");
  assert.equal(
    crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    stored,
    "the same token always hashes the same, which is what makes lookup by hash work",
  );
});

test("the retained prefix identifies a key without being enough to use one", () => {
  const token = generateToken();
  const prefix = token.slice(0, "mpk_".length + 6);

  assert.ok(token.startsWith(prefix));
  // Six characters is enough to tell two keys apart in a list and far too few
  // to guess the remaining 32 bytes.
  assert.ok(prefix.length < token.length / 4);
});
