import assert from "node:assert/strict";
import test from "node:test";

import { parkingTarget, PIT_BASE_URL } from "../lib/parking.ts";

test("a Moshpit name goes to the Pit's page for it, not a parked card here", () => {
  assert.equal(parkingTarget({ name: "hawaiian.chicken" }), `${PIT_BASE_URL}/n/hawaiian.chicken`);
  assert.equal(parkingTarget({ name: "scrambled.eggs" }), `${PIT_BASE_URL}/n/scrambled.eggs`);
});

test("the name is normalized before it becomes a path", () => {
  assert.equal(parkingTarget({ name: "  Scrambled.EGGS " }), `${PIT_BASE_URL}/n/scrambled.eggs`);
});

test("a Porkbun-glued query is stripped back to the bare name", () => {
  // "scrambled.eggs?ref=abc" must not leak into the path.
  assert.equal(
    parkingTarget({ name: "scrambled.eggs?ref=abc123" }),
    `${PIT_BASE_URL}/n/scrambled.eggs`,
  );
});

test("?dn= still works, so the older link shape does not break", () => {
  assert.equal(parkingTarget({ dn: "moshcode.sh" }), `${PIT_BASE_URL}/n/moshcode.sh`);
});

test("no usable name falls back to the Pit itself rather than a 404", () => {
  for (const sp of [{}, { name: "   " }, { name: "" }, { name: "notaname" }]) {
    assert.equal(parkingTarget(sp), `${PIT_BASE_URL}/pit`, `for ${JSON.stringify(sp)}`);
  }
});

test("the target host is fixed, so a hostile name cannot redirect off-site", () => {
  // safeDomain() rejects or strips these; the assertion is that nothing which
  // survives it can change the host we send people to.
  for (const name of [
    "evil.com/../../out",
    "https://evil.com",
    "evil.com#@attacker.test",
    "//evil.com",
  ]) {
    const target = parkingTarget({ name });
    assert.ok(
      target.startsWith(`${PIT_BASE_URL}/`),
      `${JSON.stringify(name)} escaped to ${target}`,
    );
  }
});
