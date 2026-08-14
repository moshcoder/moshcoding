import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOM_CODE_MAX, cleanCustomCode, cleanCustomCss, configFor } from "../lib/config.ts";
import { sanitizeTenantConfig } from "../lib/tenant-config.ts";

const SNIPPET = '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>';

test("analytics snippets survive verbatim — nothing is stripped or rewritten", () => {
  assert.equal(cleanCustomCode(SNIPPET), SNIPPET);
  assert.equal(sanitizeTenantConfig({ headHtml: SNIPPET }).headHtml, SNIPPET);
  assert.equal(sanitizeTenantConfig({ bodyHtml: SNIPPET }).bodyHtml, SNIPPET);
});

test("custom code is bounded, control bytes dropped, blank means unset", () => {
  assert.equal(cleanCustomCode("<b>a\x00\x07b</b>"), "<b>ab</b>");
  assert.equal(cleanCustomCode("<b>a\n\tb</b>"), "<b>a\n\tb</b>");
  assert.equal(cleanCustomCode("   \n  "), null);
  assert.equal(cleanCustomCode(undefined), null);
  assert.equal(cleanCustomCode(42), null);
  assert.equal(cleanCustomCode("x".repeat(CUSTOM_CODE_MAX + 500)).length, CUSTOM_CODE_MAX);
  assert.equal(sanitizeTenantConfig({ headHtml: "  " }).headHtml, undefined);
});

test("CSS can't close its own <style> element early", () => {
  assert.equal(
    cleanCustomCss("body{}</style><script>alert(1)</script>"),
    // Only the CLOSING tags matter — with `</style` broken, the rest never
    // leaves the <style> element, so a bare `<script>` stays inert text.
    "body{}<\\/style><script>alert(1)<\\/script>",
  );
  assert.equal(cleanCustomCss("body { color: red; }"), "body { color: red; }");
});

const CODE = { headHtml: SNIPPET, bodyHtml: "<img src='https://x/p.gif'>", customCss: "body { color: red; }" };

test("custom code is emitted only when the tenant's own host is serving the page", () => {
  // moshcoding.com/?dn=<domain> — our origin, and parking a domain proves
  // nothing about owning it, so the owner's code must not run here.
  const preview = configFor("example.com", { tenantOverride: CODE });
  assert.equal(preview.headHtml, null);
  assert.equal(preview.bodyHtml, null);
  assert.equal(preview.customCss, null);

  // Served on example.com itself — its own origin, so the code runs.
  const live = configFor("example.com", { tenantOverride: CODE, allowCustomCode: true });
  assert.equal(live.headHtml, SNIPPET);
  assert.equal(live.bodyHtml, CODE.bodyHtml);
  assert.equal(live.customCss, CODE.customCss);
});

test("a tenant with no custom code saved gets nulls, not undefined", () => {
  const cfg = configFor("example.com", { tenantOverride: {}, allowCustomCode: true });
  assert.equal(cfg.headHtml, null);
  assert.equal(cfg.bodyHtml, null);
  assert.equal(cfg.customCss, null);
});
