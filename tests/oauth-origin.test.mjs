import assert from "node:assert/strict";
import test from "node:test";

import { allowedHosts, defaultOrigin, redirectUriFor, requestHost, resolveOrigin } from "../lib/oauth-origin.ts";

const env = (over = {}) => ({ APP_BASE_URL: "https://moshcoding.com", ...over });

test("an allowlisted host becomes the origin", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  assert.equal(resolveOrigin("pit.moshcode.sh", true, e), "https://pit.moshcode.sh");
});

test("APP_BASE_URL's own host is always allowed without being listed", () => {
  assert.equal(resolveOrigin("moshcoding.com", true, env()), "https://moshcoding.com");
  assert.ok(allowedHosts(env()).has("moshcoding.com"));
});

test("an unlisted host never reaches the redirect_uri", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  // The whole point of the allowlist: a spoofed Host must not redirect the
  // authorization code to an attacker.
  assert.equal(resolveOrigin("evil.example", true, e), "https://moshcoding.com");
  assert.equal(redirectUriFor(resolveOrigin("evil.example", true, e), e), "https://moshcoding.com/auth/coinpay/callback");
});

test("a suffix of an allowed host is not itself allowed", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  assert.equal(resolveOrigin("evilpit.moshcode.sh", true, e), "https://moshcoding.com");
  assert.equal(resolveOrigin("pit.moshcode.sh.evil.example", true, e), "https://moshcoding.com");
  assert.equal(resolveOrigin("moshcode.sh", true, e), "https://moshcoding.com");
});

test("a host with an attacker-appended port is not the allowed host", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  assert.equal(resolveOrigin("pit.moshcode.sh:8080", true, e), "https://moshcoding.com");
});

test("missing or empty host falls back", () => {
  assert.equal(resolveOrigin(null, true, env()), "https://moshcoding.com");
  assert.equal(resolveOrigin("", true, env()), "https://moshcoding.com");
  assert.equal(resolveOrigin("   ", true, env()), "https://moshcoding.com");
});

test("only the first host in a comma-joined header is considered", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  assert.equal(resolveOrigin("pit.moshcode.sh, evil.example", true, e), "https://pit.moshcode.sh");
  // ...and a leading spoof still has to be on the list.
  assert.equal(resolveOrigin("evil.example, pit.moshcode.sh", true, e), "https://moshcoding.com");
});

test("host matching is case-insensitive", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "PIT.MoshCode.sh" });
  assert.equal(resolveOrigin("Pit.Moshcode.SH", true, e), "https://pit.moshcode.sh");
});

test("the allowlist accepts full origins and whitespace, not just bare hosts", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: " https://pit.moshcode.sh/ , moshcode.sh " });
  assert.equal(resolveOrigin("pit.moshcode.sh", true, e), "https://pit.moshcode.sh");
  assert.equal(resolveOrigin("moshcode.sh", true, e), "https://moshcode.sh");
});

test("an empty allowlist entry does not allow the empty host", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: ",,  ," });
  assert.equal(allowedHosts(e).has(""), false);
  assert.equal(resolveOrigin("", true, e), "https://moshcoding.com");
});

test("scheme follows the request, so http dev hosts stay http", () => {
  const e = { APP_BASE_URL: "http://localhost:8080", OAUTH_ALLOWED_HOSTS: "localhost:3000" };
  assert.equal(resolveOrigin("localhost:3000", false, e), "http://localhost:3000");
  assert.equal(defaultOrigin(e), "http://localhost:8080");
});

test("authorize and callback derive the same redirect_uri for the same host", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" });
  // Token exchange fails unless these match byte for byte.
  const atAuthorize = redirectUriFor(resolveOrigin("pit.moshcode.sh", true, e), e);
  const atCallback = redirectUriFor(resolveOrigin("pit.moshcode.sh", true, e), e);
  assert.equal(atAuthorize, atCallback);
  assert.equal(atAuthorize, "https://pit.moshcode.sh/auth/coinpay/callback");
});

test("OAUTH_REDIRECT_URI still pins the redirect_uri when set", () => {
  const e = env({ OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh", OAUTH_REDIRECT_URI: "https://pinned.example/cb" });
  assert.equal(redirectUriFor(resolveOrigin("pit.moshcode.sh", true, e), e), "https://pinned.example/cb");
});

test("trailing slashes never double up in the redirect_uri", () => {
  assert.equal(redirectUriFor("https://x.example/", {}), "https://x.example/auth/coinpay/callback");
  assert.equal(defaultOrigin({ APP_BASE_URL: "https://moshcoding.com///" }), "https://moshcoding.com");
});

test("a malformed APP_BASE_URL does not throw or widen the allowlist", () => {
  const e = { APP_BASE_URL: "not a url", OAUTH_ALLOWED_HOSTS: "pit.moshcode.sh" };
  assert.equal(resolveOrigin("pit.moshcode.sh", true, e), "https://pit.moshcode.sh");
  assert.equal(resolveOrigin("evil.example", true, e), "not a url");
});

test("requestHost prefers x-forwarded-host over host", () => {
  const h = new Headers({ host: "internal.railway.internal", "x-forwarded-host": "pit.moshcode.sh" });
  assert.equal(requestHost(h), "pit.moshcode.sh");
  assert.equal(requestHost(new Headers({ host: "moshcoding.com" })), "moshcoding.com");
  assert.equal(requestHost(new Headers()), "");
});
