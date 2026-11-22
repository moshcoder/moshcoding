import assert from "node:assert/strict";
import test from "node:test";

import { hostFromHeaders, robotsTxt, sitemapHost, sitemapXml } from "../lib/sitemap.ts";

test("app host lists its public pages on its own host", () => {
  const xml = sitemapXml("moshcoding.com", "moshcoding.com");
  assert.match(xml, /<urlset /);
  assert.match(xml, /<loc>https:\/\/moshcoding\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/moshcoding\.com\/pit<\/loc>/);
  assert.doesNotMatch(xml, /dashboard|\/api\//);
});

test("a parked domain lists only its own home page", () => {
  const xml = sitemapXml("moshscript.com", "moshcoding.com");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ["https://moshscript.com/"]);
});

test("host is taken from the request, without www or port", () => {
  assert.equal(sitemapHost("www.Moshcoders.com:443"), "moshcoders.com");
  assert.equal(sitemapHost("bad host"), null);
  const h = new Headers({ host: "moshcoders.com" });
  assert.equal(hostFromHeaders(h), "moshcoders.com");
  assert.match(robotsTxt("moshcoders.com"), /^Sitemap: https:\/\/moshcoders\.com\/sitemap\.xml$/m);
});
