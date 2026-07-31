// TLD names are the primary key of the whole namespace, so a name that
// normalises two ways, or a reserved name slipping through, is a namespace bug
// rather than a validation nit.
import assert from "node:assert/strict";
import test from "node:test";

import { RESERVED_TLDS, normalizeTld, tldRejection } from "../lib/moshpit-name.ts";

test("normalizeTld accepts what people actually type", () => {
  assert.equal(normalizeTld("eggs"), "eggs");
  assert.equal(normalizeTld(".eggs"), "eggs");
  assert.equal(normalizeTld("  .EGGS  "), "eggs");
  assert.equal(normalizeTld("scrambled-eggs"), "scrambled-eggs");
  assert.equal(normalizeTld("web3"), "web3");
});

test("normalizeTld rejects a domain given where a TLD was asked for", () => {
  // "scrambled.eggs" is a domain. Silently registering ".scrambled" or ".eggs"
  // from it would hand someone a name they never asked for.
  assert.equal(normalizeTld("scrambled.eggs"), null);
  assert.equal(normalizeTld(".a.b"), null);
});

test("normalizeTld rejects anything that is not a valid hostname label", () => {
  for (const bad of ["-eggs", "eggs-", "eg gs", "eggs!", "", "   ", null, undefined, "a".repeat(64)]) {
    assert.equal(normalizeTld(bad), null, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("normalizeTld rejects all-numeric labels", () => {
  // Ambiguous against an IPv4 literal once it is part of a hostname.
  assert.equal(normalizeTld("123"), null);
});

test("normalizeTld is idempotent", () => {
  for (const raw of [".EGGS", "eggs", " .Scrambled-Eggs "]) {
    const once = normalizeTld(raw);
    assert.equal(normalizeTld(once), once);
  }
});

test("reserved names cannot be claimed", () => {
  // Trading on someone else's trust, our own names, and legacy-internet
  // collisions all have to be blocked before the first sale, not after.
  for (const name of ["bank", "apple", "google", "paypal", "gov", "moshpit", "moshcode", "com", "localhost"]) {
    assert.equal(tldRejection(name), "that name is reserved", `${name} should be reserved`);
  }
});

test("a TLD needs at least two characters", () => {
  assert.equal(tldRejection("a"), "a TLD needs at least 2 characters");
});

test("ordinary names are allowed", () => {
  for (const name of ["eggs", "preshy", "scrambled", "toast"]) {
    assert.equal(tldRejection(name), null, `${name} should be claimable`);
  }
});

test("the reserved list is stored normalised, so a lookup cannot miss on case", () => {
  for (const name of RESERVED_TLDS) {
    assert.equal(name, name.toLowerCase());
    assert.equal(normalizeTld(name), name);
  }
});
