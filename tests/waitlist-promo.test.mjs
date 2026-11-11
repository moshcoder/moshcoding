import assert from "node:assert/strict";
import test from "node:test";

import { sendWaitlistVerification } from "../lib/email.ts";

// The waitlist confirm email carries the shared "more from the network" block
// (@profullstack/cross-promo) below the confirm button, never promoting the
// sender. Capture the outgoing Resend payload; use the bundled catalog.
async function capture(opts) {
  const prev = { key: process.env.RESEND_API_KEY, promo: process.env.CROSS_PROMO, fetch: globalThis.fetch };
  process.env.RESEND_API_KEY = "test_key";
  process.env.CROSS_PROMO = "bundled";
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: "x" }), text: async () => "" };
  };
  try {
    await sendWaitlistVerification(opts);
  } finally {
    globalThis.fetch = prev.fetch;
    for (const [k, v] of [["RESEND_API_KEY", prev.key], ["CROSS_PROMO", prev.promo]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return captured;
}

const promoLinks = (html) =>
  [...html.matchAll(/href="(https?:\/\/[^"]*utm_campaign=cross-promo[^"]*)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&")));

test("waitlist email shows the network block below the confirm button", async () => {
  const p = await capture({ email: "u@example.com", token: "tok" });
  const links = promoLinks(p.html);
  assert.ok(links.length > 0, "html carries the promo block");
  assert.ok(p.html.indexOf("utm_campaign=cross-promo") > p.html.indexOf("Confirm my spot"), "below the confirm button");
  assert.ok(p.html.indexOf("utm_campaign=cross-promo") > p.html.indexOf("/api/waitlist/verify?token=tok"), "below the confirm link");
  assert.match(p.text, /utm_campaign=cross-promo/);
  assert.ok(p.text.indexOf("utm_campaign") > p.text.indexOf("/api/waitlist/verify"), "text: confirm link first");
  for (const u of links) {
    assert.notEqual(u.hostname, "moshcoding.com", "never promotes moshcoding.com");
    assert.equal(u.searchParams.get("utm_source"), "moshcoding.com");
  }
});

test("a tenant on a catalog property never promotes itself", async () => {
  const p = await capture({ email: "u@example.com", token: "tok", brand: "hqterm", site: "hqterm.sh" });
  const links = promoLinks(p.html);
  assert.ok(links.length > 0);
  for (const u of links) assert.ok(!["hqterm.sh", "moshcoding.com"].includes(u.hostname));
  assert.doesNotMatch(p.text, /https:\/\/hqterm\.sh/);
});
