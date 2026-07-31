// The codec is the part of the resolver that strangers feed arbitrary bytes
// to, so the tests care as much about what it refuses as about what it decodes.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASS,
  RCODE,
  TYPE,
  decodeMessage,
  decodeName,
  encodeMessage,
  encodeName,
  ipv4ToBytes,
  ipv6ToBytes,
  ipv6ToString,
  setMessageId,
  udpPayloadSize,
} from "../lib/dns/wire.ts";

const query = (name, type = TYPE.A, extra = {}) =>
  encodeMessage({
    id: 0x1234,
    flags: { rd: true },
    questions: [{ name, type, class: CLASS.IN }],
    ...extra,
  });

test("a question survives a round trip", () => {
  const decoded = decodeMessage(query("scrambled.eggs"));
  assert.equal(decoded.id, 0x1234);
  assert.equal(decoded.flags.rd, true);
  assert.equal(decoded.flags.qr, false);
  assert.deepEqual(decoded.questions, [{ name: "scrambled.eggs", type: TYPE.A, class: CLASS.IN }]);
});

test("answers of every type we synthesize survive a round trip", () => {
  const encoded = encodeMessage({
    id: 7,
    flags: { qr: true, aa: true, ra: true, rcode: RCODE.NOERROR },
    questions: [{ name: "scrambled.eggs", type: TYPE.A, class: CLASS.IN }],
    answers: [
      { name: "scrambled.eggs", type: TYPE.CNAME, class: CLASS.IN, ttl: 60, target: "scrambled.agent" },
      { name: "scrambled.agent", type: TYPE.A, class: CLASS.IN, ttl: 60, address: "203.0.113.7" },
      { name: "scrambled.agent", type: TYPE.AAAA, class: CLASS.IN, ttl: 60, address: "2606:4700::1111" },
      { name: "scrambled.agent", type: TYPE.TXT, class: CLASS.IN, ttl: 60, txt: ["v=moshpit1 name=scrambled.eggs"] },
    ],
    authorities: [
      {
        name: "eggs",
        type: TYPE.SOA,
        class: CLASS.IN,
        ttl: 60,
        soa: {
          mname: "pit.moshcode.sh",
          rname: "hostmaster.pit.moshcode.sh",
          serial: 1,
          refresh: 3600,
          retry: 600,
          expire: 604800,
          minimum: 60,
        },
      },
    ],
  });

  const decoded = decodeMessage(encoded);
  assert.equal(decoded.flags.qr, true);
  assert.equal(decoded.flags.aa, true);
  assert.equal(decoded.answers[0].target, "scrambled.agent");
  assert.equal(decoded.answers[1].address, "203.0.113.7");
  assert.equal(decoded.answers[2].address, "2606:4700::1111");
  assert.deepEqual(decoded.answers[3].txt, ["v=moshpit1 name=scrambled.eggs"]);
  assert.equal(decoded.authorities[0].soa.mname, "pit.moshcode.sh");
  assert.equal(decoded.authorities[0].soa.minimum, 60);
});

test("compressed names decode against the whole message", () => {
  // "eggs" at offset 12, then a pointer back to it from a second name.
  const buf = Buffer.concat([
    Buffer.alloc(12),
    Buffer.from([4, 0x65, 0x67, 0x67, 0x73, 0]), // "eggs."
    Buffer.from([9, ...Buffer.from("scrambled")]),
    Buffer.from([0xc0, 12]), // pointer -> offset 12
  ]);
  assert.equal(decodeName(buf, 12).name, "eggs");
  const second = decodeName(buf, 18);
  assert.equal(second.name, "scrambled.eggs");
  assert.equal(second.offset, buf.length);
});

test("a compression pointer that loops is rejected rather than hung on", () => {
  // A pointer at offset 12 pointing at itself: the classic parser hang.
  const buf = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12])]);
  assert.throws(() => decodeName(buf, 12), /forward compression pointer/);
});

test("truncated messages raise instead of reading past the end", () => {
  assert.throws(() => decodeMessage(Buffer.alloc(5)), /truncated/);
  // Claims one question, then stops mid-name.
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4);
  assert.throws(() => decodeMessage(Buffer.concat([head, Buffer.from([4, 0x65])])), /truncated/);
});

test("a message claiming more records than it carries is rejected", () => {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4); // one question
  head.writeUInt16BE(5, 6); // ...and five answers that are not there
  assert.throws(() => decodeMessage(Buffer.concat([head, encodeName("scrambled.eggs"), Buffer.alloc(4)])), /truncated/);
});

test("flags encode and decode in both directions", () => {
  const encoded = encodeMessage({
    id: 1,
    flags: { qr: true, opcode: 0, aa: true, tc: true, rd: true, ra: true, ad: true, cd: true, rcode: RCODE.NXDOMAIN },
  });
  const flags = decodeMessage(encoded).flags;
  assert.deepEqual(flags, {
    qr: true,
    opcode: 0,
    aa: true,
    tc: true,
    rd: true,
    ra: true,
    z: false,
    ad: true,
    cd: true,
    rcode: RCODE.NXDOMAIN,
  });
});

test("addresses encode both ways, and nonsense is refused", () => {
  assert.deepEqual([...ipv4ToBytes("203.0.113.7")], [203, 0, 113, 7]);
  assert.throws(() => ipv4ToBytes("203.0.113"), /not an IPv4/);
  assert.throws(() => ipv4ToBytes("203.0.113.999"), /not an IPv4/);

  assert.equal(ipv6ToString(ipv6ToBytes("2606:4700::1111")), "2606:4700::1111");
  assert.equal(ipv6ToString(ipv6ToBytes("::1")), "::1");
  assert.equal(ipv6ToString(ipv6ToBytes("2001:db8:0:0:1:0:0:1")), "2001:db8::1:0:0:1");
  assert.throws(() => ipv6ToBytes("2606:4700:::1111"), /not an IPv6/);
  assert.throws(() => ipv6ToBytes("hello"), /not an IPv6/);
});

test("names longer than the protocol allows are refused", () => {
  assert.throws(() => encodeName(`${"a".repeat(64)}.eggs`), /label too long/);
  assert.throws(() => encodeName(new Array(30).fill("abcdefghij").join(".")), /name too long/);
});

test("the advertised UDP payload size comes from EDNS, floored at 512", () => {
  const plain = decodeMessage(query("scrambled.eggs"));
  assert.equal(udpPayloadSize(plain), 512);

  const withOpt = decodeMessage(
    query("scrambled.eggs", TYPE.A, {
      additionals: [{ name: "", type: TYPE.OPT, class: 4096, ttl: 0, rdata: Buffer.alloc(0) }],
    }),
  );
  // Capped at 1232: bigger datagrams fragment, and fragments get lost.
  assert.equal(udpPayloadSize(withOpt), 1232);

  const tiny = decodeMessage(
    query("scrambled.eggs", TYPE.A, {
      additionals: [{ name: "", type: TYPE.OPT, class: 200, ttl: 0, rdata: Buffer.alloc(0) }],
    }),
  );
  assert.equal(udpPayloadSize(tiny), 512);
});

test("setMessageId rewrites the id without touching the rest", () => {
  const original = query("scrambled.eggs");
  const rewritten = setMessageId(original, 0xbeef);
  assert.equal(decodeMessage(rewritten).id, 0xbeef);
  assert.deepEqual(decodeMessage(rewritten).questions, decodeMessage(original).questions);
  assert.equal(decodeMessage(original).id, 0x1234, "the original buffer is left alone");
});
