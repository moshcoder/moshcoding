import assert from "node:assert/strict";
import test from "node:test";

import {
  sendGithubClosedNotification,
  sendWaitlistVerification,
  sendPasswordReset,
} from "../lib/email.ts";

/**
 * These emails interpolate external/tenant-controlled values (a GitHub issue
 * title, the actor, the tenant brand) into an HTML body. Raw interpolation
 * let those values inject markup into the rendered email. Capture the outgoing
 * Resend payload and assert the HTML body is escaped.
 */
async function capturePayload(run) {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test_key"; // force the real send() path
  let captured = null;
  globalThis.fetch = async (_url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: "x" }), text: async () => "" };
  };
  try {
    await run();
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
  return captured;
}

test("github notification escapes an attacker-controlled issue title in the HTML body", async () => {
  const payload = await capturePayload(() =>
    sendGithubClosedNotification({
      to: "owner@example.com",
      kind: "issue",
      repo: "moshcoder/moshcode",
      number: 1,
      title: "<script>alert(document.cookie)</script>",
      url: "https://github.com/x",
      actor: 'evil"><b>pwn</b>',
      merged: false,
    }),
  );
  assert.ok(!payload.html.includes("<script>"), "raw <script> must not reach the HTML body");
  assert.ok(!payload.html.includes("<b>pwn</b>"), "raw actor markup must not reach the HTML body");
  assert.ok(payload.html.includes("&lt;script&gt;"), "title should be HTML-escaped");
});

test("waitlist email escapes a malicious tenant brand in the HTML body", async () => {
  const payload = await capturePayload(() =>
    sendWaitlistVerification({ email: "u@e.com", token: "t", brand: "<img src=x onerror=alert(1)>" }),
  );
  assert.ok(!payload.html.includes("<img src=x"), "raw brand markup must not reach the HTML body");
  assert.ok(payload.html.includes("&lt;img src=x"), "brand should be HTML-escaped");
});

test("password-reset email escapes a malicious tenant brand in the HTML body", async () => {
  const payload = await capturePayload(() =>
    sendPasswordReset({ email: "u@e.com", token: "t", brand: "<b>x</b>" }),
  );
  assert.ok(!payload.html.includes("<b>x</b>"), "raw brand markup must not reach the HTML body");
  assert.ok(payload.html.includes("&lt;b&gt;x&lt;/b&gt;"), "brand should be HTML-escaped");
});

test("a benign brand still renders as normal text", async () => {
  const payload = await capturePayload(() =>
    sendWaitlistVerification({ email: "u@e.com", token: "t", brand: "moshcode" }),
  );
  assert.ok(payload.html.includes("moshcode 🤘"), "ordinary brand names must be unaffected");
});
