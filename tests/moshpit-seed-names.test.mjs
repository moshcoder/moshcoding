// The batch in scripts/seed-moshpit-names.ts is a namespace allocation, so the
// assumptions it rests on are worth pinning: that every requested name is a
// legal TLD, that the second-level names really do fall under the TLD claimed
// for them, and that the one reserved name in the list still needs the
// deliberate bypass rather than having quietly become claimable.
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTld, tldRejection } from "../lib/moshpit-name.ts";
import { parseMoshpitName } from "../lib/moshpit-name.ts";

/** Mirrors the TLDS table in scripts/seed-moshpit-names.ts. */
const REQUESTED = [
  { tld: "yeah", reserved: false, carries: ["fuck.yeah"] },
  { tld: "oranges", reserved: false, carries: ["chovy.oranges", "california.oranges"] },
  { tld: "agent", reserved: false, carries: ["profullstack.agent"] },
  { tld: "profullstack", reserved: true, carries: [] },
  { tld: "sploof", reserved: false, carries: ["original.sploof"] },
  { tld: "agentic", reserved: false, carries: [] },
];

test("every requested TLD is a legal TLD label", () => {
  for (const { tld } of REQUESTED) {
    assert.equal(normalizeTld(tld), tld, `.${tld} should normalise to itself`);
  }
});

test("only .profullstack needs the reserved bypass", () => {
  for (const { tld, reserved } of REQUESTED) {
    const rejection = tldRejection(tld);
    if (reserved) {
      // If this ever goes null, the name became publicly claimable and the
      // script's `allowReserved` is no longer protecting anything.
      assert.ok(rejection, `.${tld} is expected to be reserved`);
    } else {
      assert.equal(rejection, null, `.${tld} should be freely registrable, got: ${rejection}`);
    }
  }
});

test("each second-level name falls under the TLD claimed for it", () => {
  // Registering `.yeah` is what delivers `fuck.yeah`; if the name parsed to a
  // different TLD the batch would silently not cover it.
  for (const { tld, carries } of REQUESTED) {
    for (const name of carries) {
      const parsed = parseMoshpitName(name);
      assert.ok(parsed, `${name} should parse as a moshpit name`);
      assert.equal(parsed.tld, tld, `${name} should sit under .${tld}`);
    }
  }
});

test("the alias pair are both in the batch", () => {
  // setAlias requires the same account to hold both ends, so registering
  // `.agentic` without `.agent` (or vice versa) would fail at the alias step.
  const held = new Set(REQUESTED.map((r) => r.tld));
  assert.ok(held.has("agentic"), "alias source .agentic must be registered");
  assert.ok(held.has("agent"), "alias target .agent must be registered");
});
