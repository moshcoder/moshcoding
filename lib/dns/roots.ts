// Does the legacy root know this TLD?
//
// The catch-all needs this and nothing else. Sending someone who typed
// `mosh.whatever` to the pit is a good answer, because `.whatever` is a TLD the
// old internet does not have and nobody could have meant anything else. Doing
// the same for `asdkjh.com` would be typo-squatting the entire internet — the
// behaviour ISPs were rightly hated for — so the difference has to be checked,
// not assumed.
//
// Checked by asking the upstreams rather than by shipping an IANA list: a
// bundled list is stale the week after it is written, and this question is one
// cached query per TLD, not per name.

import type { Forwarder } from "./upstream";
import { CLASS, RCODE, TYPE, decodeMessage, encodeMessage } from "./wire";

export type RootProbe = {
  /** True when the legacy root has this TLD. Unknown counts as "yes". */
  exists(tld: string): Promise<boolean>;
};

export function createRootProbe(options: {
  forwarder: Forwarder;
  /** How long an answer is trusted. New TLDs are rare; this can be hours. */
  ttlMs?: number;
  now?: () => number;
  randomId?: () => number;
}): RootProbe {
  const ttlMs = options.ttlMs ?? 3_600_000;
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => Math.floor(Math.random() * 0x10000));

  const cache = new Map<string, { value: boolean; expires: number }>();
  const inflight = new Map<string, Promise<boolean>>();

  async function probe(tld: string): Promise<boolean> {
    const payload = encodeMessage({
      id: randomId(),
      flags: { qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, z: false, ad: false, cd: false, rcode: 0 },
      // SOA at the TLD apex: every real TLD has one, and it is a single
      // question rather than a walk down the tree.
      questions: [{ name: tld, type: TYPE.SOA, class: CLASS.IN }],
    });

    try {
      const response = decodeMessage(await options.forwarder.query(payload));
      // NXDOMAIN is the only answer that means "this TLD is not in the root".
      // NOERROR — with or without records — means it exists, and a SERVFAIL
      // means we do not know.
      const missing = response.flags.rcode === RCODE.NXDOMAIN;
      const value = !missing;
      cache.set(tld, { value, expires: now() + (missing ? ttlMs : ttlMs * 24) });
      return value;
    } catch {
      // Unreachable upstream must not turn into "this TLD does not exist",
      // which would hand the entire internet to the catch-all. Fail closed,
      // and retry soon rather than caching the failure for an hour.
      cache.set(tld, { value: true, expires: now() + 10_000 });
      return true;
    }
  }

  return {
    async exists(rawTld: string) {
      const tld = String(rawTld ?? "").trim().toLowerCase().replace(/\.$/, "");
      if (!tld) return true;

      const hit = cache.get(tld);
      if (hit && hit.expires > now()) return hit.value;

      const existing = inflight.get(tld);
      if (existing) return existing;

      const promise = probe(tld).finally(() => inflight.delete(tld));
      inflight.set(tld, promise);
      return promise;
    },
  };
}
