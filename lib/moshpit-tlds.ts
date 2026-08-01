import { PIT_BASE_URL } from "./parking";

/**
 * Is this host a name on the Moshpit network, or an ordinary parked domain?
 *
 * Asked of the Pit per name rather than by pulling its ending list: that list
 * is capped (200 at the time of writing) and `.eggs` already falls outside it,
 * so matching against it would quietly answer "no" for real names. `resolve`
 * has no such ceiling — its `registered` flag is exactly "an ending the pit
 * holds", which is the question here.
 *
 * This app keeps its own `moshpit_tlds` rows, but they are a cache of a
 * registry that lives elsewhere; a name claimed minutes ago has to work.
 */

/** Long enough not to hit the Pit per request, short enough for a new ending to show up. */
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 2_000;
/** Host is attacker-controlled, so the memo cannot be allowed to grow without end. */
const MAX_ENTRIES = 2_000;

const cache = new Map<string, { at: number; ours: boolean }>();

function remember(name: string, ours: boolean): void {
  // Whole-map eviction rather than LRU bookkeeping: this is a small memo in
  // front of a 5-minute TTL, and the cost of a cold start is one request.
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(name, { at: Date.now(), ours });
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

  try {
    const res = await fetch(
      `${PIT_BASE_URL}/api/moshpit/resolve?name=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
    );
    if (!res.ok) return hit?.ours ?? false;
    const json = (await res.json()) as { registered?: boolean };
    const ours = json?.registered === true;
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
