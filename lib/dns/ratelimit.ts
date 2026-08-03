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

/**
 * The local machine, which is never rate limited.
 *
 * The limit above prices an attack that needs a forged source address, and
 * loopback cannot be forged from off the box: the kernel drops a 127/8 source
 * arriving on a real interface. So there is nothing to price here.
 *
 * There is a great deal to lose, though, the moment a machine points its own
 * resolver at this (`DNS=127.0.0.1:5354`). Every query on that machine then
 * arrives from one address and shares a single bucket sized for one client, so
 * the sustained rate becomes the whole machine's DNS budget. A page load bursts
 * well past it, and over-budget queries are dropped rather than refused —
 * correct against a spoofing victim, and the worst possible answer locally,
 * where it means the stub waits out a full timeout, retries, and the page loads
 * with subresources that never resolved.
 */
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

export function isLoopback(remote: string | undefined): boolean {
  return LOOPBACK.test(String(remote ?? "").trim().toLowerCase());
}

export function createRateLimiter(options: {
  /** Sustained queries per second, per client. */
  qps?: number;
  /** How far above the sustained rate a client may burst. */
  burst?: number;
  /** Cap on tracked clients, so the limiter cannot itself be a memory leak. */
  maxClients?: number;
  now?: () => number;
} = {}): RateLimiter {
  // Sized for a browser rather than against one — a client here is an address,
  // and behind one address is a laptop with tabs open, or a whole office. See
  // the note on DEFAULT_QPS in scripts/moshpit-dns.ts.
  const qps = options.qps ?? 200;
  const burst = options.burst ?? 600;
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
