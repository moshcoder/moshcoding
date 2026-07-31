// The resolver's client for the Moshpit registry.
//
// Over HTTP rather than straight into Turso on purpose. The registry is
// authoritative and the gateway is not (PRD 0004 R2), and that boundary only
// means something if a resolver is a *reader* of the registry — which is what
// makes it self-hostable by anyone (R8) without handing out database
// credentials.
//
// Everything here exists to keep a slow or missing registry from becoming a
// slow or missing internet: bounded timeouts, a cache in front, request
// coalescing so a flood of identical queries is one lookup, and failures that
// return null instead of throwing so the server falls back to clearnet.

import type { RegistryLookup } from "./answers";

export type RegistryClient = {
  lookup(name: string): Promise<RegistryLookup | null>;
  stats(): { hits: number; misses: number; errors: number; entries: number };
  clear(): void;
};

type Entry = { value: RegistryLookup | null; expires: number };

export const DEFAULT_REGISTRY_BASE = "https://pit.moshcode.sh";

export function createRegistryClient(options: {
  base?: string;
  /** How long a registry answer is trusted. Short: names change hands. */
  ttlMs?: number;
  /** How long a failure is remembered, so an outage is not amplified into a flood. */
  errorTtlMs?: number;
  timeoutMs?: number;
  maxEntries?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}): RegistryClient {
  const base = (options.base ?? DEFAULT_REGISTRY_BASE).replace(/\/+$/, "");
  const ttlMs = options.ttlMs ?? 60_000;
  const errorTtlMs = options.errorTtlMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<RegistryLookup | null>>();
  const stats = { hits: 0, misses: 0, errors: 0 };

  function remember(name: string, value: RegistryLookup | null, ttl: number) {
    // A plain Map iterates in insertion order, so the first key is the oldest
    // — good enough eviction for a cache whose entries all expire in a minute.
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(name, { value, expires: now() + ttl });
  }

  async function fetchName(name: string): Promise<RegistryLookup | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${base}/api/moshpit/resolve?name=${encodeURIComponent(name)}`;
      const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
      // A 400 means the registry considers this not a Moshpit name at all —
      // a definite "no", worth caching for as long as a real answer.
      if (res.status === 400) {
        remember(name, null, ttlMs);
        return null;
      }
      if (!res.ok) throw new Error(`registry responded ${res.status}`);
      const json = (await res.json()) as Partial<RegistryLookup>;
      if (typeof json?.registered !== "boolean") throw new Error("registry response missing `registered`");
      const value: RegistryLookup = {
        name: typeof json.name === "string" ? json.name : name,
        resolved: typeof json.resolved === "string" ? json.resolved : name,
        registered: json.registered,
        aliased: Boolean(json.aliased),
        exempt: Boolean(json.exempt),
        target: typeof json.target === "string" && json.target ? json.target : null,
      };
      // The registry may also return the owner's own preference for whether
      // this name should beat clearnet. It is read and not acted on: on a
      // public resolver, letting a name owner decide that their `.com`
      // lookalike outranks the real one is the hijack this project's own
      // resolution policy exists to prevent. Which namespace wins is the
      // resolver operator's call (MOSHPIT_RESOLVE_MODE), and through it the
      // user's, because they chose the resolver.
      remember(name, value, ttlMs);
      return value;
    } catch {
      stats.errors++;
      remember(name, null, errorTtlMs);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async lookup(rawName: string) {
      const name = String(rawName ?? "").trim().toLowerCase().replace(/\.$/, "");
      if (!name) return null;

      const hit = cache.get(name);
      if (hit && hit.expires > now()) {
        stats.hits++;
        return hit.value;
      }
      stats.misses++;

      // One lookup per name in flight. Without this, a client retrying a
      // query it thinks was lost turns into N registry requests for one name.
      const existing = inflight.get(name);
      if (existing) return existing;

      const promise = fetchName(name).finally(() => inflight.delete(name));
      inflight.set(name, promise);
      return promise;
    },
    stats: () => ({ ...stats, entries: cache.size }),
    clear: () => {
      cache.clear();
      inflight.clear();
    },
  };
}
