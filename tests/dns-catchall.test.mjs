// The catch-all is the difference between "that name does not exist" and "that
// name could be yours". It is also one rule away from being a typo-squatter for
// the whole internet, so the boundary gets tested harder than the feature.
import assert from "node:assert/strict";
import test from "node:test";

import { createGatewayResolver } from "../lib/dns/gateway.ts";
import { createRegistryClient } from "../lib/dns/registry.ts";
import { createRootProbe } from "../lib/dns/roots.ts";
import { createDnsServer } from "../lib/dns/server.ts";
import { createForwarder } from "../lib/dns/upstream.ts";
import { CLASS, RCODE, TYPE, decodeMessage, encodeMessage } from "../lib/dns/wire.ts";

const GATEWAY_V4 = "203.0.113.7";

const query = (name, type = TYPE.A) =>
  encodeMessage({ id: 0x77, flags: { rd: true }, questions: [{ name, type, class: CLASS.IN }] });

/**
 * An upstream that knows a set of real TLDs and a set of real names. Anything
 * else is NXDOMAIN — including a SOA query for an ending the root does not
 * have, which is exactly how the root probe tells them apart.
 */
function stubUpstream({ realTlds = ["com", "org"], zone = {} } = {}) {
  return async (_upstream, payload) => {
    const q = decodeMessage(payload);
    const question = q.questions[0];
    const isRealTld = question.type === TYPE.SOA && realTlds.includes(question.name);
    const address = zone[question.name];
    const found = isRealTld || address;
    return encodeMessage({
      id: q.id,
      flags: { qr: true, rd: true, ra: true, rcode: found ? RCODE.NOERROR : RCODE.NXDOMAIN },
      questions: q.questions,
      answers: address ? [{ name: question.name, type: TYPE.A, class: CLASS.IN, ttl: 300, address }] : [],
    });
  };
}

function harness({ catchAll = true, names = {}, zone = {}, realTlds } = {}) {
  const forwarder = createForwarder({ ask: stubUpstream({ realTlds, zone }) });
  const registry = createRegistryClient({
    base: "http://registry.test",
    fetchImpl: async (url) => {
      const name = new URL(url).searchParams.get("name");
      return new Response(JSON.stringify({ name, resolved: name, registered: Boolean(names[name]) }), { status: 200 });
    },
  });
  return createDnsServer({
    registry,
    forwarder,
    gateway: createGatewayResolver({ host: "pit.moshcode.sh", forwarder, ipv4: [GATEWAY_V4], ipv6: [] }),
    catchAll,
    rootProbe: createRootProbe({ forwarder }),
    port: 0,
    address: "127.0.0.1",
  });
}

const addresses = (msg) => msg.answers.filter((r) => r.type === TYPE.A).map((r) => r.address);

test("an unclaimed name under an ending the root does not have goes to the pit", async () => {
  const dns = harness();
  const response = decodeMessage(await dns.handle(query("mosh.whatever")));

  assert.equal(response.flags.rcode, RCODE.NOERROR);
  assert.deepEqual(addresses(response), [GATEWAY_V4]);
  assert.equal(response.flags.aa, false, "nobody holds this name — claiming authority over it would be a lie");
  assert.equal(dns.stats().catchall, 1);
  await dns.close();
});

test("a name that does not exist under a REAL TLD is left alone", async () => {
  // This is the whole boundary: `asdkjh.com` is NXDOMAIN too, and answering it
  // would make this resolver a typo-squatter for the entire internet.
  const dns = harness();
  const response = decodeMessage(await dns.handle(query("asdkjh.com")));

  assert.equal(response.flags.rcode, RCODE.NXDOMAIN);
  assert.equal(dns.stats().catchall, 0);
  await dns.close();
});

test("with the catch-all off, an unclaimed name is still NXDOMAIN", async () => {
  const dns = harness({ catchAll: false });
  assert.equal(decodeMessage(await dns.handle(query("mosh.whatever"))).flags.rcode, RCODE.NXDOMAIN);
  assert.equal(dns.stats().catchall, 0);
  await dns.close();
});

test("a claimed name still answers as itself, not as a catch-all", async () => {
  const dns = harness({ names: { "scrambled.eggs": true } });
  const response = decodeMessage(await dns.handle(query("scrambled.eggs")));

  assert.equal(response.flags.aa, true, "a registered name IS authoritative");
  assert.equal(dns.stats().moshpit, 1);
  assert.equal(dns.stats().catchall, 0);
  await dns.close();
});

test("clearnet still wins whenever clearnet has an answer", async () => {
  const dns = harness({ zone: { "example.com": "198.51.100.9" } });
  assert.deepEqual(addresses(decodeMessage(await dns.handle(query("example.com")))), ["198.51.100.9"]);
  assert.equal(dns.stats().catchall, 0);
  await dns.close();
});

test("the TXT record says the name is unclaimed, so nobody thinks they own it", async () => {
  const dns = harness();
  const response = decodeMessage(await dns.handle(query("mosh.whatever", TYPE.TXT)));
  assert.match(response.answers.find((r) => r.type === TYPE.TXT).txt[0], /unclaimed=1/);
  await dns.close();
});

test("the root is asked once per ending, not once per name", async () => {
  let soaQueries = 0;
  const forwarder = createForwarder({
    ask: async (_u, payload) => {
      const q = decodeMessage(payload);
      if (q.questions[0].type === TYPE.SOA) soaQueries++;
      return encodeMessage({
        id: q.id,
        flags: { qr: true, rd: true, ra: true, rcode: RCODE.NXDOMAIN },
        questions: q.questions,
      });
    },
  });
  const probe = createRootProbe({ forwarder });
  assert.equal(await probe.exists("whatever"), false);
  assert.equal(await probe.exists("whatever"), false);
  assert.equal(soaQueries, 1, "cached");
  forwarder.close();
});

test("an unreachable root fails closed, so an outage cannot hand over the internet", async () => {
  const forwarder = createForwarder({
    ask: async () => {
      throw new Error("network down");
    },
  });
  const probe = createRootProbe({ forwarder });
  assert.equal(await probe.exists("whatever"), true, "unknown must mean 'the root has it'");
  forwarder.close();
});
