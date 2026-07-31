// A DNS wire-format codec — encode and decode RFC 1035 messages.
//
// Written out rather than pulled from npm because the resolver is the one
// process on the network that strangers can send arbitrary bytes to on UDP/53,
// and a parser bug there is remotely reachable by anyone. A few hundred lines
// we can read end to end beats a transitive dependency tree we cannot.
//
// The decoder is deliberately total: every malformed input raises a plain
// Error, which the server turns into FORMERR. It never throws a RangeError
// from a short read, because a crash loop is a denial of service that anyone
// could trigger with one packet.

export const TYPE = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  OPT: 41,
  ANY: 255,
} as const;

export const CLASS = { IN: 1, CH: 3, NONE: 254, ANY: 255 } as const;

export const RCODE = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
} as const;

export type Flags = {
  qr: boolean;
  opcode: number;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  z: boolean;
  ad: boolean;
  cd: boolean;
  rcode: number;
};

export type Question = { name: string; type: number; class: number };

export type SoaData = {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
};

/**
 * One resource record.
 *
 * `address`/`target`/`txt`/`soa` are the decoded forms for the handful of types
 * this resolver actually synthesizes. Everything else keeps its bytes in
 * `rdata` untouched, so a record we do not understand still survives a
 * decode/encode round trip rather than being silently dropped.
 */
export type ResourceRecord = {
  name: string;
  type: number;
  class: number;
  ttl: number;
  address?: string;
  target?: string;
  txt?: string[];
  soa?: SoaData;
  rdata?: Buffer;
};

export type Message = {
  id: number;
  flags: Flags;
  questions: Question[];
  answers: ResourceRecord[];
  authorities: ResourceRecord[];
  additionals: ResourceRecord[];
};

const MAX_NAME_LENGTH = 255;
const MAX_LABEL_LENGTH = 63;
/** Pointers may chain, but not forever — a self-referential pointer is a hang. */
const MAX_POINTER_JUMPS = 64;

function need(buf: Buffer, offset: number, bytes: number) {
  if (offset < 0 || offset + bytes > buf.length) throw new Error("truncated DNS message");
}

/** Decode a (possibly compressed) name, returning it and the offset after it. */
export function decodeName(buf: Buffer, offset: number): { name: string; offset: number } {
  const labels: string[] = [];
  let jumps = 0;
  let pos = offset;
  let afterPointer = -1;
  let length = 0;

  for (;;) {
    need(buf, pos, 1);
    const len = buf[pos];

    if (len === 0) {
      pos += 1;
      break;
    }

    // Top two bits set marks a pointer to an earlier name in the message.
    if ((len & 0xc0) === 0xc0) {
      need(buf, pos, 2);
      const target = ((len & 0x3f) << 8) | buf[pos + 1];
      if (afterPointer < 0) afterPointer = pos + 2;
      if (++jumps > MAX_POINTER_JUMPS) throw new Error("compression pointer loop");
      // A pointer must go backwards; forward pointers are how loops are built.
      if (target >= pos) throw new Error("forward compression pointer");
      pos = target;
      continue;
    }

    if (len > MAX_LABEL_LENGTH) throw new Error("label too long");
    need(buf, pos + 1, len);
    length += len + 1;
    if (length > MAX_NAME_LENGTH) throw new Error("name too long");
    labels.push(buf.toString("latin1", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }

  return { name: labels.join("."), offset: afterPointer >= 0 ? afterPointer : pos };
}

/** Encode a name uncompressed. Compression is optional; correctness is not. */
export function encodeName(name: string): Buffer {
  const trimmed = String(name ?? "").replace(/\.$/, "");
  if (!trimmed) return Buffer.from([0]);
  const labels = trimmed.split(".");
  const parts: Buffer[] = [];
  let length = 0;
  for (const label of labels) {
    const bytes = Buffer.from(label, "latin1");
    if (bytes.length === 0) throw new Error("empty label in name");
    if (bytes.length > MAX_LABEL_LENGTH) throw new Error("label too long");
    length += bytes.length + 1;
    if (length > MAX_NAME_LENGTH) throw new Error("name too long");
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function decodeFlags(value: number): Flags {
  return {
    qr: (value & 0x8000) !== 0,
    opcode: (value >> 11) & 0x0f,
    aa: (value & 0x0400) !== 0,
    tc: (value & 0x0200) !== 0,
    rd: (value & 0x0100) !== 0,
    ra: (value & 0x0080) !== 0,
    z: (value & 0x0040) !== 0,
    ad: (value & 0x0020) !== 0,
    cd: (value & 0x0010) !== 0,
    rcode: value & 0x000f,
  };
}

function encodeFlags(f: Partial<Flags> = {}): number {
  return (
    ((f.qr ? 1 : 0) << 15) |
    (((f.opcode ?? 0) & 0x0f) << 11) |
    ((f.aa ? 1 : 0) << 10) |
    ((f.tc ? 1 : 0) << 9) |
    ((f.rd ? 1 : 0) << 8) |
    ((f.ra ? 1 : 0) << 7) |
    ((f.z ? 1 : 0) << 6) |
    ((f.ad ? 1 : 0) << 5) |
    ((f.cd ? 1 : 0) << 4) |
    ((f.rcode ?? 0) & 0x0f)
  );
}

/** Decode an IPv6 address from 16 bytes into its usual text form. */
export function ipv6ToString(bytes: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  // Collapse the longest run of zero groups, as everyone writes it.
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0") {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const len = i - start;
      if (len > bestLen) [bestStart, bestLen] = [start, len];
      start = -1;
    }
  }
  if (bestLen < 2) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLen).join(":")}`;
}

/** Encode an IPv6 address, including the `::` form. Throws on anything else. */
export function ipv6ToBytes(address: string): Buffer {
  const text = String(address ?? "").trim().toLowerCase();
  if (!text || text.includes(":::")) throw new Error(`not an IPv6 address: ${address}`);
  const [head, tail, extra] = text.split("::");
  if (extra !== undefined) throw new Error(`not an IPv6 address: ${address}`);

  const parse = (part: string) =>
    part
      .split(":")
      .filter((g) => g !== "")
      .map((g) => {
        if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`not an IPv6 address: ${address}`);
        return parseInt(g, 16);
      });

  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const gap = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : gap < 1) throw new Error(`not an IPv6 address: ${address}`);

  const groups = tail === undefined ? left : [...left, ...new Array(gap).fill(0), ...right];
  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(g, i * 2));
  return buf;
}

/** Encode an IPv4 dotted quad. Throws rather than emitting a wrong address. */
export function ipv4ToBytes(address: string): Buffer {
  const parts = String(address ?? "").trim().split(".");
  if (parts.length !== 4) throw new Error(`not an IPv4 address: ${address}`);
  const buf = Buffer.alloc(4);
  parts.forEach((part, i) => {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`not an IPv4 address: ${address}`);
    const octet = Number(part);
    if (octet > 255) throw new Error(`not an IPv4 address: ${address}`);
    buf[i] = octet;
  });
  return buf;
}

function decodeRecord(buf: Buffer, offset: number): { record: ResourceRecord; offset: number } {
  const namePart = decodeName(buf, offset);
  let pos = namePart.offset;
  need(buf, pos, 10);
  const type = buf.readUInt16BE(pos);
  const klass = buf.readUInt16BE(pos + 2);
  const ttl = buf.readUInt32BE(pos + 4);
  const rdlength = buf.readUInt16BE(pos + 8);
  pos += 10;
  need(buf, pos, rdlength);
  const rdata = buf.subarray(pos, pos + rdlength);

  const record: ResourceRecord = { name: namePart.name, type, class: klass, ttl, rdata: Buffer.from(rdata) };

  try {
    if (type === TYPE.A && rdlength === 4) {
      record.address = `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
    } else if (type === TYPE.AAAA && rdlength === 16) {
      record.address = ipv6ToString(rdata);
    } else if (type === TYPE.CNAME || type === TYPE.NS || type === TYPE.PTR) {
      // Decoded against the whole message: rdata names may use compression
      // pointers into earlier sections.
      record.target = decodeName(buf, pos).name;
    } else if (type === TYPE.TXT) {
      const strings: string[] = [];
      let p = pos;
      while (p < pos + rdlength) {
        const len = rdata[p - pos];
        strings.push(buf.toString("utf8", p + 1, Math.min(p + 1 + len, pos + rdlength)));
        p += 1 + len;
      }
      record.txt = strings;
    } else if (type === TYPE.SOA) {
      const mname = decodeName(buf, pos);
      const rname = decodeName(buf, mname.offset);
      let p = rname.offset;
      need(buf, p, 20);
      record.soa = {
        mname: mname.name,
        rname: rname.name,
        serial: buf.readUInt32BE(p),
        refresh: buf.readUInt32BE(p + 4),
        retry: buf.readUInt32BE(p + 8),
        expire: buf.readUInt32BE(p + 12),
        minimum: buf.readUInt32BE(p + 16),
      };
    }
  } catch {
    // A record whose rdata will not decode is still a record. Keep the bytes
    // and move on rather than failing the entire message over one field we
    // were only reading for convenience.
  }

  return { record, offset: pos + rdlength };
}

function encodeRdata(record: ResourceRecord): Buffer {
  if (record.type === TYPE.A && record.address) return ipv4ToBytes(record.address);
  if (record.type === TYPE.AAAA && record.address) return ipv6ToBytes(record.address);
  if ((record.type === TYPE.CNAME || record.type === TYPE.NS || record.type === TYPE.PTR) && record.target) {
    return encodeName(record.target);
  }
  if (record.type === TYPE.TXT && record.txt) {
    const parts: Buffer[] = [];
    for (const s of record.txt) {
      const bytes = Buffer.from(s, "utf8");
      // A TXT string is length-prefixed with a single byte, so long values are
      // split into 255-byte chunks — the same string, just chunked.
      for (let i = 0; i < Math.max(bytes.length, 1); i += 255) {
        const chunk = bytes.subarray(i, i + 255);
        parts.push(Buffer.from([chunk.length]), chunk);
      }
    }
    return Buffer.concat(parts);
  }
  if (record.type === TYPE.SOA && record.soa) {
    const tail = Buffer.alloc(20);
    tail.writeUInt32BE(record.soa.serial >>> 0, 0);
    tail.writeUInt32BE(record.soa.refresh, 4);
    tail.writeUInt32BE(record.soa.retry, 8);
    tail.writeUInt32BE(record.soa.expire, 12);
    tail.writeUInt32BE(record.soa.minimum, 16);
    return Buffer.concat([encodeName(record.soa.mname), encodeName(record.soa.rname), tail]);
  }
  return record.rdata ?? Buffer.alloc(0);
}

function encodeRecord(record: ResourceRecord): Buffer {
  const name = encodeName(record.name);
  const rdata = encodeRdata(record);
  const head = Buffer.alloc(10);
  head.writeUInt16BE(record.type, 0);
  head.writeUInt16BE(record.class ?? CLASS.IN, 2);
  head.writeUInt32BE(record.ttl >>> 0, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name, head, rdata]);
}

export function decodeMessage(buf: Buffer): Message {
  need(buf, 0, 12);
  const id = buf.readUInt16BE(0);
  const flags = decodeFlags(buf.readUInt16BE(2));
  const counts = [buf.readUInt16BE(4), buf.readUInt16BE(6), buf.readUInt16BE(8), buf.readUInt16BE(10)];

  let offset = 12;
  const questions: Question[] = [];
  for (let i = 0; i < counts[0]; i++) {
    const namePart = decodeName(buf, offset);
    offset = namePart.offset;
    need(buf, offset, 4);
    questions.push({ name: namePart.name, type: buf.readUInt16BE(offset), class: buf.readUInt16BE(offset + 2) });
    offset += 4;
  }

  const sections: ResourceRecord[][] = [[], [], []];
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < counts[s + 1]; i++) {
      const part = decodeRecord(buf, offset);
      offset = part.offset;
      sections[s].push(part.record);
    }
  }

  return { id, flags, questions, answers: sections[0], authorities: sections[1], additionals: sections[2] };
}

export function encodeMessage(msg: Partial<Message>): Buffer {
  const questions = msg.questions ?? [];
  const answers = msg.answers ?? [];
  const authorities = msg.authorities ?? [];
  const additionals = msg.additionals ?? [];

  const head = Buffer.alloc(12);
  head.writeUInt16BE(msg.id ?? 0, 0);
  head.writeUInt16BE(encodeFlags(msg.flags), 2);
  head.writeUInt16BE(questions.length, 4);
  head.writeUInt16BE(answers.length, 6);
  head.writeUInt16BE(authorities.length, 8);
  head.writeUInt16BE(additionals.length, 10);

  const parts: Buffer[] = [head];
  for (const q of questions) {
    const type = Buffer.alloc(4);
    type.writeUInt16BE(q.type, 0);
    type.writeUInt16BE(q.class ?? CLASS.IN, 2);
    parts.push(encodeName(q.name), type);
  }
  for (const section of [answers, authorities, additionals]) {
    for (const record of section) parts.push(encodeRecord(record));
  }
  return Buffer.concat(parts);
}

/** Overwrite the transaction id in place — used to unmask a forwarded query. */
export function setMessageId(buf: Buffer, id: number): Buffer {
  const copy = Buffer.from(buf);
  copy.writeUInt16BE(id & 0xffff, 0);
  return copy;
}

/**
 * The UDP payload size the client will accept, from its EDNS0 OPT record.
 *
 * Without EDNS a client is only guaranteed to take 512 bytes (RFC 1035), so
 * that is the floor. The ceiling is 1232: larger UDP responses fragment on
 * real networks, and fragments are both lost and spoofable.
 */
export function udpPayloadSize(msg: Message): number {
  const opt = msg.additionals?.find((r) => r.type === TYPE.OPT);
  if (!opt) return 512;
  return Math.min(Math.max(opt.class || 512, 512), 1232);
}
