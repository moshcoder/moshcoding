import { PIT_BASE_URL } from "./parking";

/**
 * Is this host a name on the Moshpit network, or an ordinary parked domain?
 *
 * Asked of the Pit per name rather than by pulling its ending list: that list
 * is capped (200 at the time of writing) and `.eggs` already falls outside it,
 * so matching against it would quietly answer "no" for real names. `resolve`
 * has no such ceiling — and it answers the question we actually have, which is
 * not "does the pit hold this ending" but "should the pit outrank DNS here".
 *
 * This app keeps its own `moshpit_tlds` rows, but they are a cache of a
 * registry that lives elsewhere; a name claimed minutes ago has to work.
 *
 * The Pit states the rule and the client applies it. `prefer` is that rule:
 *
 *   "clearnet" — nothing registered here; ignore the pit
 *   "fallback" — use the pit only where the legacy root has no answer  (default)
 *   "moshpit"  — use the pit even where the legacy root answers        (opt-in)
 *
 * Reading `registered` alone — as this did until a real ccTLD got claimed —
 * collapses "fallback" into "moshpit" and hands the pit every domain whose
 * ending someone claimed. `.sh` was claimed, so `moshcode.sh` (a domain we own,
 * that resolves, that was serving its own page) started bouncing visitors to
 * the Pit's claim page for a name it said nobody held. A real extension wins by
 * default; overriding the legacy internet is something you opt into.
 */

/** Long enough not to hit the Pit per request, short enough for a new ending to show up. */
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 2_000;
/** Host is attacker-controlled, so the memo cannot be allowed to grow without end. */
const MAX_ENTRIES = 2_000;

/**
 * Public resolvers rather than this host's own. A box running the Moshpit
 * bridge answers for `.eggs` itself, so asking it "does the legacy root know
 * this name" would let the question answer itself.
 */
const ROOT_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

const cache = new Map<string, { at: number; ours: boolean }>();

function remember(name: string, ours: boolean): void {
  // Whole-map eviction rather than LRU bookkeeping: this is a small memo in
  // front of a 5-minute TTL, and the cost of a cold start is one request.
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(name, { at: Date.now(), ours });
}

/**
 * Which side wins when a name exists in both networks.
 *
 * Same decision, and deliberately the same name, as the resolvers'
 * `MOSHPIT_RESOLVE_MODE` and tronbrowser's "When a name exists in both"
 * setting — taken per deployment here, because a server has no visitor to ask.
 * Anything but an explicit "moshpit" is "clearnet".
 */
export function resolveMode(): "clearnet" | "moshpit" {
  return String(process.env.MOSHPIT_RESOLVE_MODE || "").trim().toLowerCase() === "moshpit"
    ? "moshpit"
    : "clearnet";
}

/**
 * Does the legacy root answer for this name?
 *
 * Only a definitive "no such name" counts as a no. A timeout, a SERVFAIL, or a
 * name that exists with no A record (ENODATA) all mean the root may well be the
 * right answer, and a blip must never be the reason a working domain starts
 * redirecting to a page offering it to strangers.
 */
async function lookUpInRoot(name: string): Promise<boolean> {
  // Imported here, not at module scope, so the module stays loadable anywhere
  // the check is stubbed and node:dns may not exist.
  const { Resolver } = await import("node:dns/promises");
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  resolver.setServers(ROOT_RESOLVERS);
  try {
    const addrs = await resolver.resolve4(name);
    return addrs.length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return !(code === "ENOTFOUND" || code === "NXDOMAIN");
  }
}

let answersInRoot = lookUpInRoot;

/** Test seam: stand in for the legacy root. Pass nothing to restore it. */
export function setRootLookup(fn?: (name: string) => Promise<boolean>): void {
  answersInRoot = fn ?? lookUpInRoot;
}

/**
 * Fails closed: an unreachable Pit answers "no", so a registry outage leaves
 * every parked domain rendering exactly as it does today rather than bouncing
 * the whole internet at `/n/`. A previously cached answer beats that fallback.
 */
export async function isMoshpitName(dn: string): Promise<boolean> {
  const name = String(dn || "").toLowerCase();
  const parts = name.split(".");
  // One label and one ending — the same shape the registry can hold.
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ours;

  const mode = resolveMode();
  try {
    const res = await fetch(
      `${PIT_BASE_URL}/api/moshpit/resolve?name=${encodeURIComponent(name)}&mode=${mode}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
    );
    if (!res.ok) return hit?.ours ?? false;
    const json = (await res.json()) as { registered?: boolean; prefer?: string };

    // A Pit too old to send `prefer` still sends `registered`, and the rule is
    // derivable from it — so an older registry gets the new behaviour too.
    const prefer =
      json?.prefer ?? (json?.registered === true ? (mode === "moshpit" ? "moshpit" : "fallback") : "clearnet");

    const ours =
      prefer === "moshpit"
        ? true
        : prefer === "fallback"
          ? !(await answersInRoot(name))
          : false;

    remember(name, ours);
    return ours;
  } catch {
    return hit?.ours ?? false;
  }
}

/** Test seam: drop the memoised answers. */
export function resetMoshpitTldCache(): void {
  cache.clear();
}
