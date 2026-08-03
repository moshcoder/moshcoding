// The Moshpit resolver: point your DNS at it and `.moshpit` works, without an
// extension and without losing the rest of the internet.
//
//   bun run dns                      # port 5354, no privileges needed
//   MOSHPIT_DNS_PORT=53 bun run dns  # the real thing (needs CAP_NET_BIND_SERVICE)
//
// Deployed as `*.pit.moshcode.sh` — see docs/moshpit-dns.md for the records to
// publish and how to run more than one of these.
//
// Everything is configured by environment variable and nothing is required:
// with no configuration at all this resolves Moshpit names from the public
// registry and forwards everything else to 8.8.8.8 and 1.1.1.1.

import { createDohServer } from "../lib/dns/doh";
import { createGatewayResolver } from "../lib/dns/gateway";
import { DEFAULT_RESOLVE_MODE, type ResolveMode } from "../lib/dns/policy";
import { createRateLimiter } from "../lib/dns/ratelimit";
import { createRegistryClient, DEFAULT_REGISTRY_BASE } from "../lib/dns/registry";
import { createRootProbe } from "../lib/dns/roots";
import { createDnsServer } from "../lib/dns/server";
import { createForwarder, parseUpstreams } from "../lib/dns/upstream";

const env = process.env;

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const list = (value: string | undefined) =>
  String(value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const port = number(env.MOSHPIT_DNS_PORT, 5354);
const address = env.MOSHPIT_DNS_ADDRESS || "0.0.0.0";
const httpPort = number(env.MOSHPIT_DNS_HTTP_PORT, 8053);
const mode = (env.MOSHPIT_RESOLVE_MODE as ResolveMode) || DEFAULT_RESOLVE_MODE;
if (mode !== "clearnet" && mode !== "moshpit") {
  console.error(`MOSHPIT_RESOLVE_MODE must be 'clearnet' or 'moshpit', got '${mode}'`);
  process.exit(1);
}

const quiet = env.MOSHPIT_DNS_LOG === "off";
const log = quiet ? () => {} : (line: string) => console.log(`[dns] ${line}`);

const upstreams = parseUpstreams(env.MOSHPIT_DNS_UPSTREAMS || "8.8.8.8,1.1.1.1");
const forwarder = createForwarder({
  upstreams,
  timeoutMs: number(env.MOSHPIT_DNS_UPSTREAM_TIMEOUT_MS, 2_000),
  staggerMs: number(env.MOSHPIT_DNS_UPSTREAM_STAGGER_MS, 400),
});

const registryBase = env.MOSHPIT_REGISTRY_BASE || DEFAULT_REGISTRY_BASE;
const registry = createRegistryClient({
  base: registryBase,
  ttlMs: number(env.MOSHPIT_REGISTRY_TTL_MS, 60_000),
  timeoutMs: number(env.MOSHPIT_REGISTRY_TIMEOUT_MS, 2_000),
});

const gatewayHost = env.MOSHPIT_GATEWAY_HOST || "pit.moshcode.sh";
const gateway = createGatewayResolver({
  host: gatewayHost,
  forwarder,
  ipv4: list(env.MOSHPIT_GATEWAY_A),
  ipv6: list(env.MOSHPIT_GATEWAY_AAAA),
});

/**
 * What one client may ask for, per second and in a burst.
 *
 * The limit prices reflection: a forged source address turns our answers into
 * someone else's inbound traffic, so a client's budget is the most we will ever
 * send a victim who never asked. It is not meant to price *browsing*.
 *
 * At 50/100 it priced browsing anyway. A client here is an address, not a
 * person, and behind one address is a laptop opening tabs — or a household, or
 * an office. A single page asks for A, AAAA and HTTPS on every hostname it
 * touches, so a few tabs clear 100 queries in a burst without trying, and the
 * excess is dropped rather than refused: nothing comes back, the stub waits out
 * its timeout, and the page finishes with subresources that never resolved.
 *
 * These numbers are still a bound, just one drawn around a browser instead of
 * inside it. What they let through is ~200 answers/sec to a spoofed victim,
 * well under 100KB/s and no kind of amplifier — ANY is already refused, which
 * is what makes the amplification factor small enough for this to be the right
 * trade.
 */
const DEFAULT_QPS = 200;
const DEFAULT_BURST = 600;

// Off unless asked for: with it on, a name nobody holds under an ending the
// legacy root does not have resolves to the gateway, which lands the visitor on
// the pit with the name filled in. That is a funnel, and a funnel is a product
// decision rather than a default a resolver should assume.
const catchAll = /^(1|true|yes|on)$/i.test(env.MOSHPIT_DNS_CATCHALL ?? "");

const dns = createDnsServer({
  registry,
  forwarder,
  gateway,
  mode,
  catchAll,
  rootProbe: catchAll ? createRootProbe({ forwarder }) : undefined,
  ttl: number(env.MOSHPIT_DNS_TTL, 60),
  address,
  port,
  rateLimiter: createRateLimiter({
    qps: number(env.MOSHPIT_DNS_QPS, DEFAULT_QPS),
    burst: number(env.MOSHPIT_DNS_BURST, DEFAULT_BURST),
  }),
  log: env.MOSHPIT_DNS_LOG === "queries" ? log : () => {},
});

const ports = await dns.listen();
log(`listening on ${address}:${ports.udp} (udp) and ${address}:${ports.tcp} (tcp), mode=${mode}`);
log(`registry ${registryBase} · gateway ${gatewayHost} · upstreams ${upstreams.map((u) => u.host).join(", ")}`);
if (catchAll) log("catch-all ON — unclaimed names under non-root endings resolve to the gateway");

// Warm the gateway addresses at boot rather than on the first query, so the
// first person through the door does not pay for the lookup.
const warm = await gateway.addresses().catch(() => null);
if (warm?.ipv4.length || warm?.ipv6.length) {
  log(`gateway ${gatewayHost} -> ${[...warm.ipv4, ...warm.ipv6].join(", ")}`);
} else {
  log(`WARNING: could not resolve ${gatewayHost} — Moshpit names will fall through to clearnet until it does`);
}

let http: ReturnType<typeof createDohServer> | null = null;
if (httpPort > 0) {
  http = createDohServer({ dns, log });
  await new Promise<void>((resolve) => http!.listen(httpPort, address, resolve));
  log(`DoH on http://${address}:${httpPort}/dns-query · health on /health`);
}

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    log(`${signal} — shutting down`);
    http?.close();
    await dns.close();
    process.exit(0);
  });
}
