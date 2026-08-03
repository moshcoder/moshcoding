// End-to-end resolver behaviour: a real server, a stub registry and a stub
// upstream. These are the cases someone would actually notice — a Moshpit name
// resolving, `.com` still working, and a contested name going to whichever
// namespace the mode says owns it.
import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import test from "node:test";

import { createGatewayResolver } from "../lib/dns/gateway.ts";
import { createRateLimiter, isLoopback } from "../lib/dns/ratelimit.ts";
import { createRegistryClient } from "../lib/dns/registry.ts";
import { createDnsServer } from "../lib/dns/server.ts";
import { createForwarder, parseUpstreams } from "../lib/dns/upstream.ts";
import { CLASS, RCODE, TYPE, decodeMessage, encodeMessage } from "../lib/dns/wire.ts";

const GATEWAY_V4 = "203.0.113.7";
const CLEARNET_V4 = "198.51.100.9";

function query(name, type = TYPE.A, id = 0x4242) {
  return encodeMessage({
    id,
    flags: { rd: true },
    questions: [{ name, type, class: CLASS.IN }],
  });
}

/** A canned upstream: NXDOMAIN unless the name is in `zone`. */
function stubUpstream(zone = {}) {
  return async (_upstream, payload) => {
    const q = decodeMessage(payload);
    const question = q.questions[0];
    const address = zone[question.name];
    return encodeMessage({
      id: q.id,
      flags: { qr: true, rd: true, ra: true, rcode: address ? RCODE.NOERROR : RCODE.NXDOMAIN },
      questions: q.questions,
      answers: address ? [{ name: question.name, type: TYPE.A, class: CLASS.IN, ttl: 300, address }] : [],
    });
  };
}

/** A registry that holds exactly the names it is given. */
function stubRegistry(names, options = {}) {
  return createRegistryClient({
    base: "http://registry.test",
    ...options,
    fetchImpl: async (url) => {
      if (options.down) throw new Error("registry unreachable");
      const name = new URL(url).searchParams.get("name");
      const entry = names[name];
      return new Response(
        JSON.stringify({
          name,
          resolved: entry?.resolved ?? name,
          registered: Boolean(entry),
          aliased: Boolean(entry?.resolved && entry.resolved !== name),
          target: entry?.target ?? null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
}

function harness({ mode = "clearnet", names = {}, zone = {}, registryDown = false, gatewayV4 = [GATEWAY_V4], ...rest } = {}) {
  const forwarder = createForwarder({ ask: stubUpstream(zone) });
  const server = createDnsServer({
    registry: stubRegistry(names, { down: registryDown }),
    forwarder,
    gateway: createGatewayResolver({ host: "pit.moshcode.sh", forwarder, ipv4: gatewayV4, ipv6: [] }),
    mode,
    ttl: 60,
    port: 0,
    address: "127.0.0.1",
    ...rest,
  });
  return server;
}

const addresses = (msg, type = TYPE.A) => msg.answers.filter((r) => r.type === type).map((r) => r.address);

test("a Moshpit name resolves to the gateway when clearnet has never heard of it", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} } });
  const response = decodeMessage(await dns.handle(query("scrambled.eggs")));

  assert.equal(response.flags.rcode, RCODE.NOERROR);
  assert.equal(response.flags.aa, true, "we are authoritative for the Moshpit namespace");
  assert.deepEqual(addresses(response), [GATEWAY_V4]);
  assert.equal(response.id, 0x4242, "the client's transaction id comes back unchanged");
  await dns.close();
});

test("the rest of the internet still works", async () => {
  const dns = harness({ zone: { "example.com": CLEARNET_V4 } });
  const response = decodeMessage(await dns.handle(query("example.com")));

  assert.deepEqual(addresses(response), [CLEARNET_V4]);
  assert.equal(dns.stats().forwarded, 1);
  assert.equal(dns.stats().moshpit, 0);
  await dns.close();
});

test("a contested name goes to clearnet by default, and to Moshpit on request", async () => {
  // `profullstack.ai` exists in both namespaces. Which one a user gets is a
  // setting, not a race.
  const contested = { names: { "profullstack.ai": {} }, zone: { "profullstack.ai": CLEARNET_V4 } };

  const backfill = harness({ ...contested, mode: "clearnet" });
  assert.deepEqual(addresses(decodeMessage(await backfill.handle(query("profullstack.ai")))), [CLEARNET_V4]);
  await backfill.close();

  const override = harness({ ...contested, mode: "moshpit" });
  assert.deepEqual(addresses(decodeMessage(await override.handle(query("profullstack.ai")))), [GATEWAY_V4]);
  await override.close();
});

test("subdomains of a Moshpit name reach the gateway too", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} } });
  const response = decodeMessage(await dns.handle(query("www.scrambled.eggs")));
  assert.deepEqual(addresses(response), [GATEWAY_V4]);
  assert.equal(response.answers[0].name, "www.scrambled.eggs");
  await dns.close();
});

test("an aliased TLD answers with the CNAME it actually followed", async () => {
  const dns = harness({ names: { "scrambled.eggs": { resolved: "scrambled.agent" } } });
  const response = decodeMessage(await dns.handle(query("scrambled.eggs")));

  assert.equal(response.answers[0].type, TYPE.CNAME);
  assert.equal(response.answers[0].target, "scrambled.agent");
  assert.deepEqual(addresses(response), [GATEWAY_V4]);
  await dns.close();
});

test("an unregistered Moshpit-shaped name is left to clearnet's verdict", async () => {
  const dns = harness({ names: {} });
  const response = decodeMessage(await dns.handle(query("nobody.eggs")));
  assert.equal(response.flags.rcode, RCODE.NXDOMAIN);
  await dns.close();
});

test("a registry outage costs Moshpit names, not the whole internet", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} }, zone: { "example.com": CLEARNET_V4 }, registryDown: true });

  assert.deepEqual(addresses(decodeMessage(await dns.handle(query("example.com")))), [CLEARNET_V4]);
  // The Moshpit name degrades to whatever clearnet says, which is NXDOMAIN —
  // a resolver that SERVFAILs here would look like a broken network.
  assert.equal(decodeMessage(await dns.handle(query("scrambled.eggs"))).flags.rcode, RCODE.NXDOMAIN);
  await dns.close();
});

test("a gateway with no known address does not answer for names it cannot serve", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} }, gatewayV4: [] });
  const response = decodeMessage(await dns.handle(query("scrambled.eggs")));
  assert.equal(response.flags.rcode, RCODE.NXDOMAIN, "better an honest NXDOMAIN than a name cached as address-less");
  await dns.close();
});

test("upstream failure becomes SERVFAIL rather than a hung client", async () => {
  const forwarder = createForwarder({
    ask: async () => {
      throw new Error("network is down");
    },
  });
  const dns = createDnsServer({
    registry: stubRegistry({}),
    forwarder,
    gateway: createGatewayResolver({ host: "pit.moshcode.sh", forwarder, ipv4: [GATEWAY_V4], ipv6: [] }),
    port: 0,
    address: "127.0.0.1",
  });
  const response = decodeMessage(await dns.handle(query("example.com")));
  assert.equal(response.flags.rcode, RCODE.SERVFAIL);
  await dns.close();
});

test("reflection bait is refused or dropped, never amplified", async () => {
  const dns = harness({ zone: { "example.com": CLEARNET_V4 } });

  const any = decodeMessage(await dns.handle(query("example.com", TYPE.ANY)));
  assert.equal(any.flags.rcode, RCODE.REFUSED);
  assert.equal(any.answers.length, 0);

  // A *response* arriving at the listening socket gets no reply at all;
  // replying would make us the second hop of someone else's attack.
  const response = encodeMessage({ id: 1, flags: { qr: true, rcode: 0 }, questions: [] });
  assert.equal(await dns.handle(response), null);

  // Garbage that is not even a header cannot be answered.
  assert.equal(await dns.handle(Buffer.from([1, 2, 3])), null);
  await dns.close();
});

test("a client over its rate limit is dropped rather than answered", async () => {
  const limiter = createRateLimiter({ qps: 0.0001, burst: 2 });
  assert.equal(limiter.allow("192.0.2.1"), true);
  assert.equal(limiter.allow("192.0.2.1"), true);
  assert.equal(limiter.allow("192.0.2.1"), false, "the third query in a burst of two is dropped");
  assert.equal(limiter.allow("192.0.2.2"), true, "a different client has its own budget");
});

test("a remote browser's page load fits inside one client's budget", () => {
  // The limit prices reflection, not browsing. A client is an address, and
  // behind one address is a laptop with tabs open: A, AAAA and HTTPS on every
  // hostname a page touches clears 100 queries without trying. At the old
  // 50/100 the excess was dropped in silence, which is a page that finishes
  // with subresources that never resolved.
  const limiter = createRateLimiter();
  let served = 0;
  for (let i = 0; i < 400; i++) if (limiter.allow("203.0.113.9")) served++;
  assert.equal(served, 400, "a burst the size of a real page load is answered in full");

  // Still a bound, though — an address cannot ask without limit.
  const capped = createRateLimiter();
  let allowed = 0;
  for (let i = 0; i < 5000; i++) if (capped.allow("203.0.113.10")) allowed++;
  assert.ok(allowed < 5000, "the budget is still finite");
});

test("the machine's own queries are never rate limited", () => {
  // Point a box's resolver at this and every query on it arrives from one
  // address. Under a per-client limit that made the whole machine share one
  // client's budget, and the excess was dropped in silence — a page load's
  // worth of subresources that simply never resolved.
  for (const local of ["127.0.0.1", "127.0.0.53", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopback(local), true, `${local} is the local machine`);
  }
  for (const remote of ["192.0.2.1", "203.0.113.7", "2606:4700::1111", "", undefined]) {
    assert.equal(isLoopback(remote), false, `${remote} is not loopback and still pays the limit`);
  }
});

test("a clearnet name with no AAAA is left to clearnet, not answered from the registry", async () => {
  // The regression this exists for: a browser asks A, AAAA and HTTPS for every
  // hostname, and most real domains answer the last two with NODATA. Reading
  // that as "clearnet came up empty" put a registry round trip in front of most
  // of the web — and where the registry held the name, it answered a real
  // domain's AAAA with the *gateway*, sending dual-stack clients to the pit.
  const forwarder = createForwarder({
    ask: async (_upstream, payload) => {
      const q = decodeMessage(payload);
      const question = q.questions[0];
      const isA = question.type === TYPE.A;
      return encodeMessage({
        id: q.id,
        flags: { qr: true, rd: true, ra: true, rcode: RCODE.NOERROR },
        questions: q.questions,
        // An ordinary dual-stack-less domain: an address, and nothing else.
        answers: isA
          ? [{ name: question.name, type: TYPE.A, class: CLASS.IN, ttl: 300, address: CLEARNET_V4 }]
          : [],
      });
    },
  });
  const registry = stubRegistry({ "profullstack.ai": {} });
  const dns = createDnsServer({
    registry,
    forwarder,
    gateway: createGatewayResolver({ host: "pit.moshcode.sh", forwarder, ipv4: [GATEWAY_V4], ipv6: ["2606:4700::1111"] }),
    mode: "clearnet",
    ttl: 60,
    port: 0,
    address: "127.0.0.1",
  });

  const v6 = decodeMessage(await dns.handle(query("profullstack.ai", TYPE.AAAA)));
  assert.deepEqual(addresses(v6, TYPE.AAAA), [], "the gateway's address must not stand in for a real domain's AAAA");
  assert.equal(v6.flags.aa, false, "clearnet's own NODATA is relayed, not replaced with an authoritative one");

  const https = decodeMessage(await dns.handle(query("profullstack.ai", TYPE.HTTPS)));
  assert.equal(https.answers.length, 0);

  assert.equal(dns.stats().moshpit, 0, "no Moshpit answer was synthesized");
  assert.equal(registry.stats().misses, 0, "and the registry was never asked");

  // The A query still resolves through clearnet, as it always did.
  assert.deepEqual(addresses(decodeMessage(await dns.handle(query("profullstack.ai")))), [CLEARNET_V4]);
  await dns.close();
});

test("EDNS is echoed, so clients keep using it", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} } });
  const withEdns = encodeMessage({
    id: 9,
    flags: { rd: true },
    questions: [{ name: "scrambled.eggs", type: TYPE.A, class: CLASS.IN }],
    additionals: [{ name: "", type: TYPE.OPT, class: 4096, ttl: 0, rdata: Buffer.alloc(0) }],
  });
  const response = decodeMessage(await dns.handle(withEdns));
  assert.ok(
    response.additionals.some((r) => r.type === TYPE.OPT),
    "an answer without OPT tells the client we do not speak EDNS",
  );
  await dns.close();
});

test("the same answers come back over UDP and over TCP", async () => {
  const dns = harness({ names: { "scrambled.eggs": {} }, zone: { "example.com": CLEARNET_V4 } });
  const ports = await dns.listen();
  assert.equal(ports.udp, ports.tcp, "both transports must answer on the same port");

  const overUdp = await new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (msg) => {
      socket.close();
      resolve(decodeMessage(msg));
    });
    socket.on("error", reject);
    socket.send(query("scrambled.eggs"), ports.udp, "127.0.0.1");
  });
  assert.deepEqual(addresses(overUdp), [GATEWAY_V4]);

  const overTcp = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: ports.tcp });
    let buffered = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("connect", () => {
      const payload = query("example.com");
      const framed = Buffer.alloc(2 + payload.length);
      framed.writeUInt16BE(payload.length, 0);
      payload.copy(framed, 2);
      socket.write(framed);
    });
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 2 || buffered.length < 2 + buffered.readUInt16BE(0)) return;
      socket.destroy();
      resolve(decodeMessage(buffered.subarray(2, 2 + buffered.readUInt16BE(0))));
    });
  });
  assert.deepEqual(addresses(overTcp), [CLEARNET_V4]);

  await dns.close();
});

test("upstream specs are parsed the way people write them", () => {
  assert.deepEqual(parseUpstreams("8.8.8.8,1.1.1.1"), [
    { host: "8.8.8.8", port: 53 },
    { host: "1.1.1.1", port: 53 },
  ]);
  assert.deepEqual(parseUpstreams("9.9.9.9:5353"), [{ host: "9.9.9.9", port: 5353 }]);
  assert.deepEqual(parseUpstreams("[2001:4860:4860::8888]:53"), [{ host: "2001:4860:4860::8888", port: 53 }]);
  assert.deepEqual(parseUpstreams("2001:4860:4860::8888"), [{ host: "2001:4860:4860::8888", port: 53 }]);
  // Nothing configured still has to resolve the internet.
  assert.deepEqual(parseUpstreams(""), [
    { host: "8.8.8.8", port: 53 },
    { host: "1.1.1.1", port: 53 },
  ]);
});

test("the registry is asked once for a name, however many clients ask us", async () => {
  let calls = 0;
  const registry = createRegistryClient({
    base: "http://registry.test",
    fetchImpl: async (url) => {
      calls++;
      const name = new URL(url).searchParams.get("name");
      return new Response(JSON.stringify({ name, resolved: name, registered: true }), { status: 200 });
    },
  });

  const [a, b] = await Promise.all([registry.lookup("scrambled.eggs"), registry.lookup("scrambled.eggs")]);
  assert.equal(a.registered, true);
  assert.equal(b.registered, true);
  await registry.lookup("scrambled.eggs");
  assert.equal(calls, 1, "coalesced in flight, then cached");
});

// A name pointed at a hostname is the case `seo.rank` hit in production: the
// answer was a CNAME to dev.profullstack.com and nothing else, and every stub
// client read that as "no such host".
test("a name pointed at a hostname answers with the address, not just the CNAME", async () => {
  const dns = harness({
    names: { "seo.rank": { target: "dev.profullstack.com" } },
    zone: { "dev.profullstack.com": CLEARNET_V4 },
  });
  const response = decodeMessage(await dns.handle(query("seo.rank")));

  assert.equal(response.flags.rcode, RCODE.NOERROR);
  // The CNAME still goes out — a `dig` should show where the name points.
  assert.ok(
    response.answers.some((r) => r.type === TYPE.CNAME && r.target === "dev.profullstack.com"),
    "the CNAME is what makes the indirection visible",
  );
  // ...but the address has to be there too. This resolver sets RA=1 and talks
  // to stub clients directly; a stub reads the answer section for an address
  // and gives up when there is none, so a bare CNAME is a failed lookup.
  assert.deepEqual(addresses(response), [CLEARNET_V4], "a stub client needs the leaf address");
  await dns.close();
});

test("an unreachable upstream still yields the CNAME rather than nothing", async () => {
  // Chasing is best-effort. Failing closed here would turn one upstream
  // hiccup into "this name does not exist".
  const dns = harness({ names: { "seo.rank": { target: "dev.profullstack.com" } }, zone: {} });
  const response = decodeMessage(await dns.handle(query("seo.rank")));

  assert.equal(response.flags.rcode, RCODE.NOERROR);
  assert.ok(response.answers.some((r) => r.type === TYPE.CNAME), "the CNAME survives an upstream failure");
  await dns.close();
});

test("a name pointed at a literal address does not get a spurious lookup", async () => {
  // Nothing to chase: the address is already the answer.
  const dns = harness({ names: { "pinned.rank": { target: "203.0.113.55" } } });
  const response = decodeMessage(await dns.handle(query("pinned.rank")));

  assert.deepEqual(addresses(response), ["203.0.113.55"]);
  assert.ok(!response.answers.some((r) => r.type === TYPE.CNAME), "no CNAME when the target is an address");
  await dns.close();
});
