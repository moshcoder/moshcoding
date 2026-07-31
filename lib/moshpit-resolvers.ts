// The public resolvers, as advertised on the site.
//
// Read from the environment rather than hardcoded, because the addresses are
// operational facts that change when a box moves, and a setup page that tells
// people to type a stale address is worse than one that tells them nothing.
//
// Addresses are validated here for the same reason: this list goes onto a page
// where strangers copy it into their network settings. A typo in an env var
// should show up as a missing entry, not as an instruction to point their DNS
// at something that is not an address at all.

export type PublicResolver = {
  /** A human name for the row, when the operator gave one. */
  name: string | null;
  address: string;
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isIpAddress(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (IPV4.test(raw)) return raw.split(".").every((octet) => Number(octet) <= 255);
  // Loose on IPv6 by design: the exact grammar lives in the resolver's codec,
  // and this only has to reject things that are obviously not addresses.
  return /^[0-9a-f:]+$/i.test(raw) && raw.includes(":") && !raw.includes(":::");
}

/**
 * Parse `dns1.pit.moshcode.sh=203.0.113.7, dns2.pit.moshcode.sh=203.0.113.8`.
 *
 * The name is optional — `203.0.113.7` on its own is a complete instruction,
 * since what a person types into their DNS settings is an address. The name is
 * there so the page can say which box they are pointing at.
 */
export function parseResolvers(spec: string | undefined | null): PublicResolver[] {
  return String(spec ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf("=");
      const name = at > 0 ? entry.slice(0, at).trim() : null;
      const address = (at > 0 ? entry.slice(at + 1) : entry).trim();
      return { name: name || null, address };
    })
    .filter((resolver) => isIpAddress(resolver.address));
}

export type ResolverConfig = {
  resolvers: PublicResolver[];
  /** The DoH endpoint, when one is published. */
  doh: string | null;
  /** Whether there is anything to tell people to use yet. */
  published: boolean;
};

export function resolverConfig(env: Record<string, string | undefined> = process.env): ResolverConfig {
  const resolvers = parseResolvers(env.MOSHPIT_DNS_RESOLVERS);
  const doh = (env.MOSHPIT_DOH_URL || "").trim();
  return {
    resolvers,
    doh: /^https:\/\/\S+$/.test(doh) ? doh : null,
    published: resolvers.length > 0,
  };
}
