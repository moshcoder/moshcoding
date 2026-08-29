import assert from "node:assert/strict";
import test from "node:test";

import { parkingRoute, parkingTarget, PIT_BASE_URL } from "../lib/parking.ts";

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

test("a Moshpit name still goes to the Pit's page for it", () => {
  assert.equal(parkingRoute({ name: "scrambled.eggs" }, true), `${PIT_BASE_URL}/n/scrambled.eggs`);
  assert.equal(parkingRoute({ name: "foo.cal" }, true), `${PIT_BASE_URL}/n/foo.cal`);
});

test("an ordinary parked domain renders its own card instead of going to the Pit", () => {
  // The regression this route shipped with: moshscript.com is a domain we own,
  // it resolves, and it has a full tenant page — the Pit's "nobody holds this
  // name" is the wrong answer for it.
  assert.equal(parkingRoute({ name: "moshscript.com" }, false), "/?dn=moshscript.com");
  assert.equal(parkingRoute({ name: "moshcode.sh" }, false), "/?dn=moshcode.sh");
});

test("the rest of the query rides along to the tenant page", () => {
  const target = parkingRoute({ name: "moshscript.com", style: "mono", ref: "abc123" }, false);
  const { pathname, searchParams } = new URL(target, "https://moshcoding.com");
  assert.equal(pathname, "/");
  assert.equal(searchParams.get("dn"), "moshscript.com");
  assert.equal(searchParams.get("style"), "mono");
  assert.equal(searchParams.get("ref"), "abc123");
  // ?name= became ?dn=; leaving both would let the raw value shadow the clean one.
  assert.equal(searchParams.get("name"), null);
});

test("a Porkbun-glued query does not survive into the tenant redirect", () => {
  assert.equal(parkingRoute({ name: "moshscript.com?ref=abc123" }, false), "/?dn=moshscript.com");
});

test("no usable name falls back to the Pit whichever side it belongs to", () => {
  for (const ours of [true, false]) {
    assert.equal(parkingRoute({}, ours), `${PIT_BASE_URL}/pit`);
    assert.equal(parkingRoute({ name: "notaname" }, ours), `${PIT_BASE_URL}/pit`);
  }
});

test("the clearnet branch cannot be talked into an off-site redirect either", () => {
  for (const name of ["https://evil.com", "//evil.com", "evil.com/../../out", "evil.com#@x.test"]) {
    const target = parkingRoute({ name }, false);
    // Relative to this app, or the fixed Pit host. Never a third party.
    assert.ok(
      target.startsWith("/?") || target.startsWith(`${PIT_BASE_URL}/`),
      `${JSON.stringify(name)} escaped to ${target}`,
    );
    if (target.startsWith("/?")) {
      assert.equal(new URL(target, "https://moshcoding.com").host, "moshcoding.com");
    }
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
