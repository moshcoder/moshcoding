// Key pins, against a real SQLite database rather than a stub.
//
// The interesting behaviour here is all in SQL and in ownership checks — which
// rows come back for an aliased name, whether a second account can publish
// under your TLD — and none of that survives being mocked. libsql takes a
// `file:` URL, so a throwaway database costs a temp directory.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

// Set before the module graph loads: lib/db reads this at first use and caches.
const dir = await mkdtemp(join(tmpdir(), "moshpit-pins-"));
process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;

const {
  PIN_KINDS, addPin, isPin, listPins, normalizePinKind, pinsForName, registerTld, removePin, setAlias,
} = await import("../lib/moshpit.ts");
const { ensureSchema } = await import("../lib/db.ts");

// Build the schema here rather than leaving it to whichever test touches the
// database first. Schema creation is lazy, so without this the whole of
// initDb() — dozens of CREATE TABLE/INDEX statements against a real file on
// disk — is billed to the first test that calls into the database, inside that
// test's 5s timeout. On a warm machine that is milliseconds and invisible; on a
// cold CI runner it crossed the limit, which is why one pin test failed on CI
// while the file passed locally in 172ms. The sibling db suites
// (project-webhook-management, waitlist-sort-db, …) already warm up this way.
await ensureSchema();

/** A pin is SHA-256 over an SPKI; any 32 bytes stand in for one here. */
const somePin = () => createHash("sha256").update(randomBytes(32)).digest("base64");

const OWNER = "acct-owner";
const STRANGER = "acct-stranger";
let counter = 0;
const freshTld = async (accountId = OWNER) => {
  const tld = `t${counter++}${randomBytes(3).toString("hex")}`;
  const result = await registerTld({ tld, accountId, ownerEmail: null, ownerKey: null });
  assert.ok(result.ok, `could not register .${tld}: ${result.error}`);
  return tld;
};

test("a pin is 32 base64 bytes, and nothing else passes", () => {
  assert.equal(isPin(somePin()), true);

  // Every one of these has been a real bug in someone's pinning code.
  assert.equal(isPin(""), false);
  assert.equal(isPin("hunter2"), false);
  assert.equal(isPin(createHash("sha1").update("x").digest("base64")), false, "sha-1 is 20 bytes");
  assert.equal(isPin(createHash("sha512").update("x").digest("base64")), false, "sha-512 is 64 bytes");
  assert.equal(isPin(randomBytes(32).toString("hex")), false, "hex is not base64");
  assert.equal(isPin(somePin().replace("=", "")), false, "unpadded");
  assert.equal(isPin(` ${somePin()}`), false, "whitespace");
  assert.equal(isPin(null), false);
  assert.equal(isPin(undefined), false);
  assert.equal(isPin(12345), false);
});

test("kinds are exactly tls and mtp", () => {
  assert.deepEqual([...PIN_KINDS], ["tls", "mtp"]);
  assert.equal(normalizePinKind("TLS"), "tls");
  assert.equal(normalizePinKind("  mtp "), "mtp");
  assert.equal(normalizePinKind("ssh"), null);
  assert.equal(normalizePinKind(""), null);
  assert.equal(normalizePinKind(null), null);
});

test("a published pin comes back for every name under the TLD", async () => {
  const tld = await freshTld();
  const pin = somePin();
  assert.ok((await addPin({ tld, pin, kind: "tls", accountId: OWNER })).ok);

  // The point of pinning per TLD: the registry has no row for either name.
  for (const name of [`scrambled.${tld}`, `anything.${tld}`]) {
    const found = await pinsForName(name);
    assert.deepEqual(found.pins.map((p) => p.pin), [pin], `wrong pins for ${name}`);
    assert.equal(found.tld, tld);
  }
});

test("a name under an unpinned TLD returns nothing, not an error", async () => {
  const tld = await freshTld();
  const found = await pinsForName(`bare.${tld}`);
  assert.deepEqual(found.pins, []);
});

test("a name outside the namespace resolves to null", async () => {
  assert.equal(await pinsForName("example.com"), null);
  assert.equal(await pinsForName("not-a-name"), null);
});

test("kinds are kept apart", async () => {
  const tld = await freshTld();
  const tls = somePin();
  const mtp = somePin();
  await addPin({ tld, pin: tls, kind: "tls", accountId: OWNER });
  await addPin({ tld, pin: mtp, kind: "mtp", accountId: OWNER });

  assert.deepEqual((await listPins(tld, "tls")).map((p) => p.pin), [tls]);
  assert.deepEqual((await listPins(tld, "mtp")).map((p) => p.pin), [mtp]);
  assert.equal((await listPins(tld)).length, 2, "unfiltered returns both");
});

test("the same pin cannot be published as two kinds", async () => {
  const tld = await freshTld();
  const pin = somePin();
  await addPin({ tld, pin, kind: "tls", accountId: OWNER });

  const result = await addPin({ tld, pin, kind: "mtp", accountId: OWNER });
  assert.equal(result.ok, false);
  assert.equal(result.taken, true);
  assert.match(result.error, /already published/);
});

test("publishing the same pin twice is a no-op, not a duplicate", async () => {
  const tld = await freshTld();
  const pin = somePin();
  await addPin({ tld, pin, kind: "tls", accountId: OWNER });
  assert.equal((await addPin({ tld, pin, kind: "tls", accountId: OWNER })).ok, true);
  assert.equal((await listPins(tld)).length, 1);
});

test("rotation: both keys live at once, then the old one goes", async () => {
  const tld = await freshTld();
  const oldKey = somePin();
  const newKey = somePin();

  await addPin({ tld, pin: oldKey, kind: "tls", accountId: OWNER });
  await addPin({ tld, pin: newKey, kind: "tls", accountId: OWNER });

  // The window that makes rotation possible without a flag day.
  const during = (await pinsForName(`site.${tld}`)).pins.map((p) => p.pin);
  assert.equal(during.length, 2);
  assert.ok(during.includes(oldKey) && during.includes(newKey));

  assert.equal((await removePin({ tld, pin: oldKey, accountId: OWNER })).ok, true);
  assert.deepEqual((await pinsForName(`site.${tld}`)).pins.map((p) => p.pin), [newKey]);
});

test("withdrawing the last key is allowed — that is how a key is revoked", async () => {
  const tld = await freshTld();
  const pin = somePin();
  await addPin({ tld, pin, kind: "tls", accountId: OWNER });

  assert.equal((await removePin({ tld, pin, accountId: OWNER })).ok, true);
  assert.deepEqual((await pinsForName(`site.${tld}`)).pins, [], "no key published means refuse, not allow");
});

test("only the TLD's owner can publish or withdraw", async () => {
  const tld = await freshTld(OWNER);
  const pin = somePin();

  const hijack = await addPin({ tld, pin, kind: "tls", accountId: STRANGER });
  assert.equal(hijack.ok, false);
  assert.match(hijack.error, /do not own/);

  await addPin({ tld, pin, kind: "tls", accountId: OWNER });
  const theft = await removePin({ tld, pin, accountId: STRANGER });
  assert.equal(theft.ok, false);
  assert.match(theft.error, /do not own/);
  assert.equal((await listPins(tld)).length, 1, "the pin survived the attempt");
});

test("an unregistered TLD cannot be pinned", async () => {
  const result = await addPin({ tld: "nobodyholdsthis", pin: somePin(), kind: "tls", accountId: OWNER });
  assert.equal(result.ok, false);
  assert.match(result.error, /not registered/);
});

test("a malformed pin is refused at the door", async () => {
  const tld = await freshTld();
  for (const bad of ["", "hunter2", randomBytes(32).toString("hex"), null]) {
    const result = await addPin({ tld, pin: bad, kind: "tls", accountId: OWNER });
    assert.equal(result.ok, false, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal((await addPin({ tld, pin: somePin(), kind: "ssh", accountId: OWNER })).ok, false);
});

test("an aliased name is pinned by the TLD it actually points at", async () => {
  const target = await freshTld();
  const alias = await freshTld();

  const targetPin = somePin();
  const aliasPin = somePin();
  await addPin({ tld: target, pin: targetPin, kind: "tls", accountId: OWNER });
  await addPin({ tld: alias, pin: aliasPin, kind: "tls", accountId: OWNER });

  assert.ok((await setAlias({ from: alias, to: target, accountId: OWNER })).ok);

  // foo.<alias> connects to whatever serves foo.<target>, so the target's key
  // is the one that will be presented. Answering with the alias's own pin
  // would refuse every working connection.
  const found = await pinsForName(`foo.${alias}`);
  assert.equal(found.resolved, `foo.${target}`);
  assert.equal(found.tld, target);
  assert.deepEqual(found.pins.map((p) => p.pin), [targetPin]);
});

test("withdrawing a pin that was never published fails", async () => {
  const tld = await freshTld();
  const result = await removePin({ tld, pin: somePin(), accountId: OWNER });
  assert.equal(result.ok, false);
});
