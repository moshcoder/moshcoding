// Where Moshpit names point: the clearnet gateway's own addresses.
//
// Looked up through the same upstream forwarder the resolver already uses,
// rather than baked into config, so moving `pit.moshcode.sh` to new hardware
// does not mean redeploying every resolver on the network. Operators who want
// to pin the addresses — a private gateway, an air-gapped grid — still can,
// with MOSHPIT_GATEWAY_A / MOSHPIT_GATEWAY_AAAA.
//
// The cache keeps the last good answer forever if it has to. A gateway address
// that is a few hours stale still serves the site; a resolver that returns
// SERVFAIL because it could not re-check an address it already knows serves
// nothing.

import type { GatewayAddresses } from "./answers";
import type { Forwarder } from "./upstream";
import { CLASS, TYPE, decodeMessage, encodeMessage } from "./wire";

export type GatewayResolver = {
  addresses(): Promise<GatewayAddresses>;
  /** The last known answer without triggering a lookup. */
  current(): GatewayAddresses;
};

export function createGatewayResolver(options: {
  host: string;
  forwarder: Forwarder;
  /** Pinned addresses. When both families are pinned, no lookup ever happens. */
  ipv4?: string[];
  ipv6?: string[];
  ttlMs?: number;
  now?: () => number;
  randomId?: () => number;
}): GatewayResolver {
  const host = options.host;
  const ttlMs = options.ttlMs ?? 300_000;
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => Math.floor(Math.random() * 0x10000));
  const pinnedV4 = options.ipv4?.filter(Boolean) ?? [];
  const pinnedV6 = options.ipv6?.filter(Boolean) ?? [];

  let cached: GatewayAddresses = { host, ipv4: [...pinnedV4], ipv6: [...pinnedV6] };
  let expires = pinnedV4.length ? Infinity : 0;
  let inflight: Promise<GatewayAddresses> | null = null;

  async function lookup(type: number): Promise<string[]> {
    const payload = encodeMessage({
      id: randomId(),
      flags: { qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false, z: false, ad: false, cd: false, rcode: 0 },
      questions: [{ name: host, type, class: CLASS.IN }],
    });
    const response = decodeMessage(await options.forwarder.query(payload));
    // CNAMEs in the chain are followed by upstream; we only want the leaves.
    return response.answers.filter((r) => r.type === type && r.address).map((r) => r.address!);
  }

  async function refresh(): Promise<GatewayAddresses> {
    const [v4, v6] = await Promise.all([
      pinnedV4.length ? Promise.resolve(pinnedV4) : lookup(TYPE.A).catch(() => [] as string[]),
      pinnedV6.length ? Promise.resolve(pinnedV6) : lookup(TYPE.AAAA).catch(() => [] as string[]),
    ]);

    // Only replace what we already have with something that actually resolved.
    // An empty answer during an outage must not blank the gateway out.
    const next: GatewayAddresses = {
      host,
      ipv4: v4.length ? v4 : cached.ipv4,
      ipv6: v6.length ? v6 : cached.ipv6,
    };
    if (next.ipv4.length || next.ipv6.length) {
      cached = next;
      expires = now() + ttlMs;
    } else {
      // Nothing known at all: retry soon rather than in five minutes.
      expires = now() + 10_000;
    }
    return cached;
  }

  return {
    async addresses() {
      if (now() < expires) return cached;
      if (!inflight) inflight = refresh().finally(() => (inflight = null));
      return inflight;
    },
    current: () => cached,
  };
}
