import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../lib/markdown.ts";

test("markdown blocks the backslash protocol-relative redirect", () => {
  // href="/\evil.com" is normalised by browsers to "//evil.com" (off-site).
  const link = renderMarkdown("[click](/\\evil.com)");
  assert.ok(!/href="\/\\/.test(link), "backslash URL must not become a link href");
  assert.ok(!link.includes("evil.com") || !link.includes("href"), "must not link off-site");
  const img = renderMarkdown("![x](/\\evil.com)");
  assert.ok(!/src="\/\\/.test(img), "backslash URL must not become an img src");
});

test("markdown still blocks // and still allows legit relative/absolute links", () => {
  assert.ok(!renderMarkdown("[x](//evil.com)").includes("href"), "// stays blocked");
  assert.ok(renderMarkdown("[x](/safe/path)").includes('href="/safe/path"'), "/path still works");
  assert.ok(renderMarkdown("[x](https://good.com)").includes('href="https://good.com"'), "https still works");
});

test("markdown blocks javascript: URIs", () => {
  assert.ok(!renderMarkdown("[x](javascript:alert(1))").toLowerCase().includes("javascript"));
});
