import assert from "node:assert/strict";
import test from "node:test";

import { isMoshpitName, resetMoshpitTldCache } from "../lib/moshpit-tlds.ts";

const realFetch = globalThis.fetch;

/** Stand in for the Pit's resolve endpoint. */
function pitSays(registeredEndings, { ok = true } = {}) {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const name = new URL(String(url)).searchParams.get("name") || "";
    const ending = name.split(".").pop();
    return { ok, json: async () => ({ name, registered: registeredEndings.includes(ending) }) };
  };
  return seen;
}

function pitIsDown() {
  globalThis.fetch = async () => {
    throw new Error("registry unreachable");
  };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetMoshpitTldCache();
});

test("a name under a Moshpit ending is ours", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs", "chicken"]);

  assert.equal(await isMoshpitName("scrambled.eggs"), true);
  assert.equal(await isMoshpitName("hawaiian.chicken"), true);
});

test("an ordinary parked domain is not ours, and keeps its tenant page", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"]);

  // `.sh` is a real TLD nobody claimed in the pit — it must not be hijacked.
  assert.equal(await isMoshpitName("moshcode.sh"), false);
  assert.equal(await isMoshpitName("example.com"), false);
});

test("only one label and one ending counts, and it never calls out for the rest", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);

  assert.equal(await isMoshpitName("a.b.eggs"), false);
  assert.equal(await isMoshpitName("eggs"), false);
  assert.equal(await isMoshpitName(""), false);
  assert.equal(seen.length, 0, "a shape the registry cannot hold needs no request");
});

test("the answer is memoised per name rather than fetched per request", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);

  await isMoshpitName("scrambled.eggs");
  await isMoshpitName("scrambled.eggs");
  await isMoshpitName("scrambled.eggs");

  assert.equal(seen.length, 1, "the Pit should be hit once per name");
});

test("the name is normalized, so case is not a cache miss", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);

  assert.equal(await isMoshpitName("Scrambled.EGGS"), true);
  assert.equal(await isMoshpitName("scrambled.eggs"), true);
  assert.equal(seen.length, 1);
});

test("an unreachable Pit fails closed rather than bouncing everything", async () => {
  resetMoshpitTldCache();
  pitIsDown();

  // The whole internet parked here must not start redirecting to /n/ because
  // the registry blipped — today's behaviour is the safe answer.
  assert.equal(await isMoshpitName("scrambled.eggs"), false);
});

test("a non-200 from the Pit is treated as unreachable", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"], { ok: false });

  assert.equal(await isMoshpitName("scrambled.eggs"), false);
});

test("a cached answer beats the fail-closed fallback when the Pit goes down", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"]);
  assert.equal(await isMoshpitName("scrambled.eggs"), true);

  pitIsDown();
  assert.equal(await isMoshpitName("scrambled.eggs"), true, "warm cache should hold");
});

test("the lookup asks the Pit for the exact name", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);

  await isMoshpitName("scrambled.eggs");

  assert.match(seen[0], /\/api\/moshpit\/resolve\?name=scrambled\.eggs$/);
});
