import assert from "node:assert/strict";
import test from "node:test";

import { isMoshpitName, resetMoshpitTldCache, setRootLookup } from "../lib/moshpit-tlds.ts";

const realFetch = globalThis.fetch;

/**
 * Stand in for the Pit's resolve endpoint.
 *
 * `prefer` is what the Pit actually sends and what decides the answer; leaving
 * it out is an older Pit that only sends `registered`, which the client derives
 * the same rule from.
 */
function pitSays(registeredEndings, { ok = true, prefer = null } = {}) {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const parsed = new URL(String(url));
    const name = parsed.searchParams.get("name") || "";
    const ending = name.split(".").pop();
    const registered = registeredEndings.includes(ending);
    return {
      ok,
      json: async () => ({
        name,
        registered,
        ...(prefer === null ? {} : { prefer }),
      }),
    };
  };
  return seen;
}

function pitIsDown() {
  globalThis.fetch = async () => {
    throw new Error("registry unreachable");
  };
}

/** Stand in for the legacy root: these names resolve on the clearnet, nothing else does. */
function rootHas(names) {
  const asked = [];
  setRootLookup(async (name) => {
    asked.push(name);
    return names.includes(name);
  });
  return asked;
}

/** The legacy root has never heard of anything — a pure Moshpit ending. */
const rootHasNothing = () => rootHas([]);

test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MOSHPIT_RESOLVE_MODE;
  setRootLookup();
  resetMoshpitTldCache();
});

test("a name under a Moshpit ending is ours", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs", "chicken"]);
  rootHasNothing();

  assert.equal(await isMoshpitName("scrambled.eggs"), true);
  assert.equal(await isMoshpitName("hawaiian.chicken"), true);
});

test("an ordinary parked domain is not ours, and keeps its tenant page", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"]);
  rootHas(["moshcode.sh", "example.com"]);

  // `.sh` is a real TLD nobody claimed in the pit — it must not be hijacked.
  assert.equal(await isMoshpitName("moshcode.sh"), false);
  assert.equal(await isMoshpitName("example.com"), false);
});

test("claiming a real extension does not take a domain that already resolves", async () => {
  resetMoshpitTldCache();
  // Someone claimed `.sh` in the pit — which is allowed, and must not matter to
  // a domain the legacy root already answers for.
  pitSays(["sh"], { prefer: "fallback" });
  rootHas(["moshcode.sh"]);

  assert.equal(await isMoshpitName("moshcode.sh"), false);
});

test("a claimed ending still fills a gap the legacy root leaves", async () => {
  resetMoshpitTldCache();
  // Same claimed `.sh`, but nothing in the root holds this name — so the pit is
  // the only answer there is, and `/n/` is where it belongs.
  pitSays(["sh"], { prefer: "fallback" });
  rootHas(["moshcode.sh"]);

  assert.equal(await isMoshpitName("nobodyholds.sh"), true);
});

test("an operator can put the pit ahead of the legacy root", async () => {
  resetMoshpitTldCache();
  process.env.MOSHPIT_RESOLVE_MODE = "moshpit";
  pitSays(["sh"], { prefer: "moshpit" });
  const asked = rootHas(["moshcode.sh"]);

  assert.equal(await isMoshpitName("moshcode.sh"), true);
  assert.equal(asked.length, 0, "nothing to ask the root when the pit outranks it");
});

test("the mode travels to the Pit, and defaults to clearnet", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);
  rootHasNothing();

  await isMoshpitName("scrambled.eggs");
  assert.match(seen[0], /[?&]mode=clearnet(&|$)/);

  resetMoshpitTldCache();
  process.env.MOSHPIT_RESOLVE_MODE = "moshpit";
  await isMoshpitName("scrambled.eggs");
  assert.match(seen[1], /[?&]mode=moshpit(&|$)/);
});

test("the Pit's own rule beats guessing from `registered`", async () => {
  resetMoshpitTldCache();
  // Registered, but the Pit says to ignore it. The Pit states the rule.
  pitSays(["eggs"], { prefer: "clearnet" });
  rootHasNothing();

  assert.equal(await isMoshpitName("scrambled.eggs"), false);
});

test("a Pit too old to send `prefer` still leaves working domains alone", async () => {
  resetMoshpitTldCache();
  pitSays(["sh"]); // no `prefer` in the payload at all
  rootHas(["moshcode.sh"]);

  assert.equal(await isMoshpitName("moshcode.sh"), false);
});

test("a root that cannot be reached is not a reason to redirect", async () => {
  resetMoshpitTldCache();
  pitSays(["sh"], { prefer: "fallback" });
  // The probe answers "it exists" for anything it could not disprove.
  setRootLookup(async () => true);

  assert.equal(await isMoshpitName("moshcode.sh"), false);
});

test("only one label and one ending counts, and it never calls out for the rest", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);
  const asked = rootHasNothing();

  assert.equal(await isMoshpitName("a.b.eggs"), false);
  assert.equal(await isMoshpitName("eggs"), false);
  assert.equal(await isMoshpitName(""), false);
  assert.equal(seen.length, 0, "a shape the registry cannot hold needs no request");
  assert.equal(asked.length, 0, "nor a DNS lookup");
});

test("the answer is memoised per name rather than fetched per request", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);
  const asked = rootHasNothing();

  await isMoshpitName("scrambled.eggs");
  await isMoshpitName("scrambled.eggs");
  await isMoshpitName("scrambled.eggs");

  assert.equal(seen.length, 1, "the Pit should be hit once per name");
  assert.equal(asked.length, 1, "and the root once per name");
});

test("the name is normalized, so case is not a cache miss", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);
  rootHasNothing();

  assert.equal(await isMoshpitName("Scrambled.EGGS"), true);
  assert.equal(await isMoshpitName("scrambled.eggs"), true);
  assert.equal(seen.length, 1);
});

test("an unreachable Pit fails closed rather than bouncing everything", async () => {
  resetMoshpitTldCache();
  pitIsDown();
  rootHasNothing();

  // The whole internet parked here must not start redirecting to /n/ because
  // the registry blipped — today's behaviour is the safe answer.
  assert.equal(await isMoshpitName("scrambled.eggs"), false);
});

test("a non-200 from the Pit is treated as unreachable", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"], { ok: false });
  rootHasNothing();

  assert.equal(await isMoshpitName("scrambled.eggs"), false);
});

test("a cached answer beats the fail-closed fallback when the Pit goes down", async () => {
  resetMoshpitTldCache();
  pitSays(["eggs"]);
  rootHasNothing();
  assert.equal(await isMoshpitName("scrambled.eggs"), true);

  pitIsDown();
  assert.equal(await isMoshpitName("scrambled.eggs"), true, "warm cache should hold");
});

test("the lookup asks the Pit for the exact name", async () => {
  resetMoshpitTldCache();
  const seen = pitSays(["eggs"]);
  rootHasNothing();

  await isMoshpitName("scrambled.eggs");

  assert.match(seen[0], /\/api\/moshpit\/resolve\?name=scrambled\.eggs&/);
});
