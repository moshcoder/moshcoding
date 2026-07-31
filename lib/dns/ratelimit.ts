// Per-client rate limiting.
//
// A public resolver is a reflector: an attacker sends a small query with your
// victim's address as the source, and we send the answer to the victim. That
// is not a hypothetical for anything listening on UDP/53 — it is the first
// thing scanners look for, usually within hours of the port opening.
//
// A token bucket per source address is the cheap half of the answer (the other
// half is dropping rather than replying, which is what the server does with
// the `false` returned here — a refusal is still a packet sent to the victim).
// Bursts are allowed because real clients do burst: a page load asks for a
// dozen names at once.

export type RateLimiter = {
  allow(key: string): boolean;
  size(): number;
};

export function createRateLimiter(options: {
  /** Sustained queries per second, per client. */
  qps?: number;
  /** How far above the sustained rate a client may burst. */
  burst?: number;
  /** Cap on tracked clients, so the limiter cannot itself be a memory leak. */
  maxClients?: number;
  now?: () => number;
} = {}): RateLimiter {
  const qps = options.qps ?? 50;
  const burst = options.burst ?? 100;
  const maxClients = options.maxClients ?? 50_000;
  const now = options.now ?? Date.now;

  type Bucket = { tokens: number; updated: number };
  const buckets = new Map<string, Bucket>();

  function sweep() {
    // Drop the buckets that have been idle long enough to have refilled
    // completely — they are indistinguishable from a client we have never
    // seen, so keeping them costs memory and buys nothing.
    const cutoff = now() - (burst / qps) * 1000;
    for (const [key, bucket] of buckets) {
      if (bucket.updated < cutoff) buckets.delete(key);
      if (buckets.size <= maxClients / 2) break;
    }
  }

  return {
    allow(key: string) {
      if (qps <= 0) return true; // limiting disabled
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxClients) sweep();
        bucket = { tokens: burst, updated: t };
        buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.updated) / 1000) * qps);
      bucket.updated = t;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
    size: () => buckets.size,
  };
}
