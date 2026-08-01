import assert from "node:assert/strict";
import test from "node:test";

import { toTenantParams } from "../lib/parking.ts";
import { safeDomain } from "../lib/config.ts";

test("toTenantParams maps ?name= onto the ?dn= the tenant renderer reads", () => {
  assert.deepEqual(toTenantParams({ name: "scrambled.eggs" }), { dn: "scrambled.eggs" });
  assert.equal(safeDomain(toTenantParams({ name: "scrambled.eggs" }).dn), "scrambled.eggs");
});

test("toTenantParams passes every other param through untouched", () => {
  const out = toTenantParams({
    name: "nonhuman.aliens",
    brand: "Nonhuman",
    ref: "abc123",
    social_bluesky: "@x",
    link_1: "https://example.com",
  });
  assert.equal(out.dn, "nonhuman.aliens");
  assert.equal(out.brand, "Nonhuman");
  assert.equal(out.ref, "abc123");
  assert.equal(out.social_bluesky, "@x");
  assert.equal(out.link_1, "https://example.com");
  assert.equal(out.name, undefined);
});

test("toTenantParams recovers a Porkbun-glued ref off the name value", () => {
  const out = toTenantParams({ name: "scrambled.eggs?ref=abc123" });
  assert.equal(out.ref, "abc123");
  // safeDomain still resolves the tenant from the glued value.
  assert.equal(safeDomain(out.dn), "scrambled.eggs");
});

test("an explicit ref wins over a glued one (first-touch stays predictable)", () => {
  const out = toTenantParams({ name: "scrambled.eggs?ref=glued", ref: "explicit" });
  assert.equal(out.ref, "explicit");
});

test("toTenantParams leaves an existing ?dn= alone when no name is given", () => {
  assert.deepEqual(toTenantParams({ dn: "moshcode.sh" }), { dn: "moshcode.sh" });
});

test("a blank or missing name yields no dn, so / falls back to the landing page", () => {
  assert.equal(toTenantParams({}).dn, undefined);
  assert.equal(toTenantParams({ name: "   " }).dn, undefined);
  assert.equal(toTenantParams({ name: "" }).dn, undefined);
});
