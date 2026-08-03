// Which namespace a query belongs to is the whole product decision, so it is
// tested as policy — no sockets, no registry, no network.
import assert from "node:assert/strict";
import test from "node:test";

import { applyAlias, classifyTarget, moshpitAnswer, soaFor } from "../lib/dns/answers.ts";
import { clearnetAnswered, moshpitCandidate, planQuery } from "../lib/dns/policy.ts";
import { CLASS, RCODE, TYPE } from "../lib/dns/wire.ts";

const question = (name, type = TYPE.A) => ({ name, type, class: CLASS.IN });
const gateway = { host: "pit.moshcode.sh", ipv4: ["203.0.113.7"], ipv6: ["2606:4700::1111"] };

test("the Moshpit name in a query is its last two labels", () => {
  assert.equal(moshpitCandidate("scrambled.eggs").name, "scrambled.eggs");
  // Browsers and mail clients ask about subdomains; the gateway sorts those
  // out by Host header, so they still belong to the registry name.
  assert.equal(moshpitCandidate("www.scrambled.eggs").name, "scrambled.eggs");
  assert.equal(moshpitCandidate("www.scrambled.eggs").prefix, "www");
  assert.equal(moshpitCandidate("_dmarc.scrambled.eggs").name, "scrambled.eggs");
});

test("names the legacy root already owns are never sent to the registry", () => {
  for (const name of ["example.com", "a.b.example.org", "profullstack.io", "thing.localhost", "site.onion"]) {
    assert.equal(moshpitCandidate(name), null, `${name} should not be a Moshpit candidate`);
  }
});

test("things that only look like names are not names", () => {
  for (const name of ["", "localhost", "203.0.113.7", "eggs", "scrambled.e", "-bad.eggs"]) {
    assert.equal(moshpitCandidate(name), null, `${name} should not be a Moshpit candidate`);
  }
});

test("a numeric ending is a real ending", () => {
  // `.2600` is registered, and the resolver used to refuse every name under
  // it — the registry sold endings that could not resolve. A numeric ending
  // under a real label can only ever be a name.
  const candidate = moshpitCandidate("alt.2600");
  assert.equal(candidate?.name, "alt.2600");
  assert.equal(candidate?.tld, "2600");
  assert.equal(candidate?.label, "alt");
  assert.equal(moshpitCandidate("www.alt.2600")?.name, "alt.2600", "subdomains of it still work");
});

test("an address is still never read as a name", () => {
  // This is what the old blanket rule was protecting, and it has to keep
  // holding: if `10.0.0.1` were a candidate, whoever registered `.1` could
  // intercept traffic meant for a machine.
  for (const address of ["10.0.0.1", "203.0.113.7", "192.168", "1.2.3.4", "8.8.8.8", "12.34"]) {
    assert.equal(moshpitCandidate(address), null, `${address} is an address, not a name`);
  }
  // Colons are IPv6, rejected earlier and for the same reason.
  assert.equal(moshpitCandidate("2604:a880:400:d1:0:4:c3fe:1"), null);
});

test("clearnet mode forwards first and lets the registry backfill", () => {
  const plan = planQuery({ question: question("scrambled.eggs"), rd: true, mode: "clearnet" });
  assert.equal(plan.action, "forward-first");
  assert.equal(plan.name, "scrambled.eggs");
});

test("moshpit mode asks the registry first, which is the whole point of it", () => {
  const plan = planQuery({ question: question("profullstack.ai"), rd: true, mode: "moshpit" });
  assert.equal(plan.action, "moshpit-first");
  assert.equal(plan.name, "profullstack.ai");
});

test("a clearnet name is forwarded in either mode", () => {
  for (const mode of ["clearnet", "moshpit"]) {
    assert.equal(planQuery({ question: question("example.com"), rd: true, mode }).action, "forward");
  }
});

test("ANY queries are refused, because that is what reflection attacks use", () => {
  const plan = planQuery({ question: question("example.com", TYPE.ANY), rd: true });
  assert.equal(plan.action, "refuse");
  assert.equal(plan.rcode, RCODE.REFUSED);
});

test("queries we cannot serve are refused with the honest rcode", () => {
  assert.equal(planQuery({ question: question("example.com"), rd: true, opcode: 5 }).rcode, RCODE.NOTIMP);
  assert.equal(planQuery({ question: question("example.com"), rd: true, questionCount: 2 }).rcode, RCODE.FORMERR);
  assert.equal(
    planQuery({ question: { name: "version.bind", type: TYPE.TXT, class: CLASS.CH }, rd: true }).rcode,
    RCODE.REFUSED,
  );
});

test("without recursion we answer only what we are authoritative for", () => {
  // A Moshpit name is ours to answer; a clearnet name would need the recursion
  // the client just said it did not want, and forwarding it anyway would make
  // this an open cache to probe.
  assert.equal(planQuery({ question: question("scrambled.eggs"), rd: false }).action, "moshpit-first");
  assert.equal(planQuery({ question: question("example.com"), rd: false }).action, "refuse");
});

test("clearnet owns a name it has heard of, whatever it was asked for", () => {
  const nodata = (type) => ({ flags: { rcode: RCODE.NOERROR }, answers: [], questions: [question("thing.dev", type)] });

  assert.equal(clearnetAnswered({ flags: { rcode: RCODE.NXDOMAIN }, answers: [] }), false);
  assert.equal(clearnetAnswered({ flags: { rcode: RCODE.NOERROR }, answers: [{ type: TYPE.A }] }), true);
  // A broken upstream is not permission to substitute our own namespace.
  assert.equal(clearnetAnswered({ flags: { rcode: RCODE.SERVFAIL }, answers: [] }), true);

  // NODATA says the name exists and has no record of THIS type. A browser asks
  // A, AAAA and HTTPS for every hostname and most real domains answer the last
  // two with nothing — so reading those as "clearnet came up empty" put a
  // registry round trip in front of most of the web, and handed the gateway's
  // address to anyone whose domain the registry happened to hold.
  assert.equal(clearnetAnswered(nodata(TYPE.AAAA)), true);
  assert.equal(clearnetAnswered(nodata(TYPE.HTTPS)), true);
  assert.equal(clearnetAnswered(nodata(TYPE.MX)), true);

  // The one case kept: an address query with no address, e.g. a clearnet name
  // parked behind an MX. Rare, so it costs a lookup almost nowhere.
  assert.equal(clearnetAnswered(nodata(TYPE.A)), false);

  // An answer we cannot attribute to a question is left to clearnet.
  assert.equal(clearnetAnswered({ flags: { rcode: RCODE.NOERROR }, answers: [] }), true);
});

test("a country-code second level is where names start, not a name", () => {
  // The last two labels of `www.bbc.co.uk` are `co.uk`. Reading that as a
  // Moshpit name meant a registry lookup on every UK page load, and in moshpit
  // mode it would have handed every site under `.co.uk` to whoever held it.
  for (const name of ["bbc.co.uk", "www.bbc.co.uk", "abc.net.au", "asahi.co.jp", "gov.uk.com.br"]) {
    const candidate = moshpitCandidate(name);
    assert.notEqual(candidate?.name, "co.uk", `${name} must not resolve to the co.uk suffix`);
  }
  assert.equal(moshpitCandidate("bbc.co.uk"), null);
  assert.equal(moshpitCandidate("www.bbc.co.uk"), null);
  assert.equal(moshpitCandidate("abc.net.au"), null);
  // A real Moshpit name that merely ends in a ccTLD-looking label still works.
  assert.equal(moshpitCandidate("scrambled.eggs")?.name, "scrambled.eggs");
});

test("a registered name answers with the gateway's addresses", () => {
  const answer = moshpitAnswer({
    id: 42,
    question: question("scrambled.eggs"),
    rd: true,
    lookup: { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true },
    gateway,
    ttl: 60,
  });

  assert.equal(answer.flags.aa, true);
  assert.equal(answer.answers.length, 1);
  assert.equal(answer.answers[0].address, "203.0.113.7");
  assert.equal(answer.answers[0].name, "scrambled.eggs");
  assert.equal(answer.authorities.length, 0);
});

test("an unregistered name produces no answer at all, so clearnet keeps it", () => {
  const answer = moshpitAnswer({
    id: 1,
    question: question("scrambled.eggs"),
    rd: true,
    lookup: { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: false },
    gateway,
    ttl: 60,
  });
  assert.equal(answer, null);
});

test("a TLD alias becomes a visible CNAME rather than a silent swap", () => {
  const lookup = { name: "scrambled.eggs", resolved: "scrambled.agent", registered: true, aliased: true };
  const answer = moshpitAnswer({ id: 1, question: question("scrambled.eggs"), rd: true, lookup, gateway, ttl: 60 });

  assert.equal(answer.answers[0].type, TYPE.CNAME);
  assert.equal(answer.answers[0].target, "scrambled.agent");
  assert.equal(answer.answers[1].type, TYPE.A);
  assert.equal(answer.answers[1].name, "scrambled.agent");
});

test("an alias applies to subdomains of the aliased name too", () => {
  const lookup = { name: "scrambled.eggs", resolved: "scrambled.agent", registered: true, aliased: true };
  assert.equal(applyAlias("www.scrambled.eggs", lookup), "www.scrambled.agent");
  assert.equal(applyAlias("scrambled.eggs", lookup), "scrambled.agent");
  // Not aliased: the name is returned untouched.
  assert.equal(applyAlias("scrambled.eggs", { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true }), "scrambled.eggs");
});

test("a type we have no data for is NODATA with an SOA, not NXDOMAIN", () => {
  const answer = moshpitAnswer({
    id: 1,
    question: question("scrambled.eggs", TYPE.MX),
    rd: true,
    lookup: { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true },
    gateway,
    ttl: 60,
  });

  assert.equal(answer.flags.rcode, RCODE.NOERROR, "the name exists — it just has no MX");
  assert.equal(answer.answers.length, 0);
  assert.equal(answer.authorities[0].type, TYPE.SOA, "without an SOA the negative answer cannot be cached");
  assert.equal(answer.authorities[0].name, "eggs");
});

test("AAAA answers only when the gateway actually has an IPv6 address", () => {
  const lookup = { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true };
  const v6 = moshpitAnswer({ id: 1, question: question("scrambled.eggs", TYPE.AAAA), rd: true, lookup, gateway, ttl: 60 });
  assert.equal(v6.answers[0].address, "2606:4700::1111");

  const v4only = moshpitAnswer({
    id: 1,
    question: question("scrambled.eggs", TYPE.AAAA),
    rd: true,
    lookup,
    gateway: { ...gateway, ipv6: [] },
    ttl: 60,
  });
  assert.equal(v4only.answers.length, 0);
  assert.equal(v4only.authorities[0].type, TYPE.SOA);
});

test("a TXT lookup says who resolved the name, for when something looks wrong", () => {
  const answer = moshpitAnswer({
    id: 1,
    question: question("scrambled.eggs", TYPE.TXT),
    rd: true,
    lookup: { name: "scrambled.eggs", resolved: "scrambled.agent", registered: true, aliased: true },
    gateway,
    ttl: 60,
  });
  const txt = answer.answers.find((r) => r.type === TYPE.TXT).txt[0];
  assert.match(txt, /v=moshpit1/);
  assert.match(txt, /resolved=scrambled\.agent/);
  assert.match(txt, /gateway=pit\.moshcode\.sh/);
});

test("a target DNS can express is honoured; one it cannot is left to the gateway", () => {
  assert.deepEqual(classifyTarget("203.0.113.9"), { kind: "ipv4", value: "203.0.113.9" });
  assert.deepEqual(classifyTarget("2606:4700::9"), { kind: "ipv6", value: "2606:4700::9" });
  assert.deepEqual(classifyTarget("origin.example.com"), { kind: "host", value: "origin.example.com" });
  // A URL is not a DNS answer. The gateway serves those by redirecting.
  assert.equal(classifyTarget("https://example.com/path").kind, "none");
  assert.equal(classifyTarget("203.0.113.999").kind, "none");
  assert.equal(classifyTarget(null).kind, "none");
});

test("a name pointed at an address resolves there instead of the gateway", () => {
  const lookup = { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true, target: "203.0.113.9" };
  const answer = moshpitAnswer({ id: 1, question: question("scrambled.eggs"), rd: true, lookup, gateway, ttl: 60 });
  assert.deepEqual(
    answer.answers.map((r) => r.address),
    ["203.0.113.9"],
  );

  // Pointed at v4 only: asking for AAAA gets NODATA, not the gateway's v6.
  const v6 = moshpitAnswer({ id: 1, question: question("scrambled.eggs", TYPE.AAAA), rd: true, lookup, gateway, ttl: 60 });
  assert.equal(v6.answers.length, 0);
});

test("a name pointed at a hostname answers with a CNAME to it", () => {
  const lookup = { name: "scrambled.eggs", resolved: "scrambled.eggs", registered: true, target: "origin.example.com" };
  const answer = moshpitAnswer({ id: 1, question: question("scrambled.eggs"), rd: true, lookup, gateway, ttl: 60 });
  assert.equal(answer.answers[0].type, TYPE.CNAME);
  assert.equal(answer.answers[0].target, "origin.example.com");
  assert.equal(answer.authorities.length, 0, "an SOA here would stop the client following the CNAME");
});

test("the synthetic SOA points at the gateway and carries the negative TTL", () => {
  const soa = soaFor("eggs", gateway, 30);
  assert.equal(soa.soa.mname, "pit.moshcode.sh");
  assert.equal(soa.soa.rname, "hostmaster.pit.moshcode.sh");
  assert.equal(soa.soa.minimum, 30);
  assert.equal(soa.ttl, 30);
});
