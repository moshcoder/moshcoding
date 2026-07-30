// Resolution starts by splitting a name, so a parser that guesses is a resolver
// that sends people somewhere they never asked for.
import assert from "node:assert/strict";
import test from "node:test";

import { parseMoshpitName } from "../lib/moshpit-name.ts";

test("splits a name into label and TLD", () => {
  assert.deepEqual(parseMoshpitName("foo.agentic"), { label: "foo", tld: "agentic" });
  assert.deepEqual(parseMoshpitName("tonyrobbins.financewizards"), {
    label: "tonyrobbins",
    tld: "financewizards",
  });
});

test("normalises case and stray dots the way people type them", () => {
  assert.deepEqual(parseMoshpitName("  FOO.Agentic  "), { label: "foo", tld: "agentic" });
  assert.deepEqual(parseMoshpitName(".foo.agentic."), { label: "foo", tld: "agentic" });
});

test("rejects anything that is not exactly one label and one TLD", () => {
  // The namespace is one level deep. "a.b.c" is malformed, not deeper — and
  // guessing which two parts were meant would resolve someone somewhere else.
  for (const bad of ["a.b.c", "foo", "", ".", "..", null, undefined, "foo.", ".agentic"]) {
    assert.equal(parseMoshpitName(bad), null, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("rejects halves that are not valid hostname labels", () => {
  for (const bad of ["-foo.agentic", "foo.-agentic", "fo o.agentic", "foo.agentic!"]) {
    assert.equal(parseMoshpitName(bad), null, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("rejects an all-numeric half, which would be ambiguous in a hostname", () => {
  assert.equal(parseMoshpitName("123.agentic"), null);
  assert.equal(parseMoshpitName("foo.123"), null);
});

test("is idempotent on its own output", () => {
  const once = parseMoshpitName("  FOO.Agentic ");
  assert.deepEqual(parseMoshpitName(`${once.label}.${once.tld}`), once);
});
