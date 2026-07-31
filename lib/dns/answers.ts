// Turning a registry lookup into a DNS answer.
//
// The registry knows names, not addresses: it can tell you that
// `scrambled.eggs` is registered and that `.eggs` currently points at
// `.agent`, but it has no idea where anything is hosted. The gateway does —
// it routes by Host header into the hosting grid (PRD 0002 R7, PRD 0004 R1).
//
// So every Moshpit name answers with the *gateway's* addresses, and the browser
// arrives carrying the Moshpit name in the Host header, which is exactly what
// the gateway needs to serve the right site. The name is not translated away;
// it is carried through.
//
// A TLD alias becomes a real CNAME rather than being silently flattened,
// because a user running `dig` deserves to see that `scrambled.eggs` is
// pointing at `scrambled.agent` instead of having to guess why the site looks
// like someone else's.

import { CLASS, TYPE, ipv6ToBytes, type Message, type Question, type ResourceRecord } from "./wire";

export type GatewayAddresses = {
  /** Where the clearnet gateway lives. */
  host: string;
  ipv4: string[];
  ipv6: string[];
};

export type RegistryLookup = {
  name: string;
  resolved: string;
  registered: boolean;
  aliased?: boolean;
  exempt?: boolean;
  /** Where the owner points the name, when they point it somewhere specific. */
  target?: string | null;
};

/**
 * What kind of thing a name's `target` is, if anything DNS can express.
 *
 * The registry stores a target as free text, and a namespace whose whole pitch
 * is "point it wherever you want" will collect URLs, addresses and hostnames in
 * the same field. DNS can carry the last two. A `https://…/path` cannot become
 * an A record — only the gateway can serve that, by redirecting — so it is
 * classified as `none` and the name falls back to the gateway rather than
 * resolving to something invented.
 */
export function classifyTarget(target?: string | null): { kind: "ipv4" | "ipv6" | "host" | "none"; value: string } {
  const raw = String(target ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return { kind: "none", value: "" };

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw) && raw.split(".").every((octet) => Number(octet) <= 255)) {
    return { kind: "ipv4", value: raw };
  }
  if (raw.includes(":")) {
    try {
      ipv6ToBytes(raw);
      return { kind: "ipv6", value: raw };
    } catch {
      return { kind: "none", value: "" };
    }
  }
  const hostLike = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw);
  // A trailing all-numeric label means this was meant to be an address and is
  // malformed — `203.0.113.999` is not a hostname, whatever the grammar says.
  if (hostLike && !/^\d+$/.test(raw.split(".").pop()!)) return { kind: "host", value: raw };
  return { kind: "none", value: "" };
}

/**
 * A synthetic SOA for a Moshpit TLD.
 *
 * Required rather than decorative: without an SOA in the authority section a
 * negative answer cannot be cached, so every client would re-ask us for every
 * name that has no AAAA — which is most of them.
 */
export function soaFor(zone: string, gateway: GatewayAddresses, negativeTtl: number): ResourceRecord {
  return {
    name: zone,
    type: TYPE.SOA,
    class: CLASS.IN,
    ttl: negativeTtl,
    soa: {
      mname: gateway.host,
      rname: `hostmaster.${gateway.host}`,
      // The registry's own log is the record of change; this serial exists to
      // satisfy the format, and nothing zone-transfers from us.
      serial: 1,
      refresh: 3600,
      retry: 600,
      expire: 604800,
      minimum: negativeTtl,
    },
  };
}

/** Rewrite `www.scrambled.eggs` to `www.scrambled.agent` when `.eggs` aliases. */
export function applyAlias(qname: string, lookup: RegistryLookup): string {
  const host = qname.replace(/\.$/, "");
  const lower = host.toLowerCase();
  if (!lookup.aliased || lookup.resolved === lookup.name) return host;
  if (lower === lookup.name) return lookup.resolved;
  if (lower.endsWith(`.${lookup.name}`)) {
    return `${host.slice(0, host.length - lookup.name.length - 1)}.${lookup.resolved}`;
  }
  return host;
}

/**
 * Build the answer for a registered Moshpit name, or null when the registry
 * says the name is not registered — the caller then falls back to clearnet
 * rather than inventing an answer.
 */
export function moshpitAnswer(opts: {
  id: number;
  question: Question;
  rd: boolean;
  lookup: RegistryLookup;
  gateway: GatewayAddresses;
  ttl: number;
  negativeTtl?: number;
}): Message | null {
  const { id, question, lookup, gateway, ttl } = opts;
  if (!lookup?.registered) return null;

  const negativeTtl = opts.negativeTtl ?? Math.min(ttl, 60);
  const target = applyAlias(question.name, lookup);
  const zone = target.split(".").pop() ?? "";
  const answers: ResourceRecord[] = [];

  if (target.toLowerCase() !== question.name.replace(/\.$/, "").toLowerCase()) {
    answers.push({ name: question.name, type: TYPE.CNAME, class: CLASS.IN, ttl, target });
  }

  // A name the owner has pointed somewhere specific goes there directly; every
  // other name goes to the gateway, which knows how to serve the grid.
  const pointer = classifyTarget(lookup.target);
  const ipv4 = pointer.kind === "ipv4" ? [pointer.value] : pointer.kind === "none" ? gateway.ipv4 : [];
  const ipv6 = pointer.kind === "ipv6" ? [pointer.value] : pointer.kind === "none" ? gateway.ipv6 : [];

  if (pointer.kind === "host" && (question.type === TYPE.A || question.type === TYPE.AAAA || question.type === TYPE.CNAME)) {
    answers.push({ name: target, type: TYPE.CNAME, class: CLASS.IN, ttl, target: pointer.value });
  }

  if (question.type === TYPE.A) {
    for (const address of ipv4) answers.push({ name: target, type: TYPE.A, class: CLASS.IN, ttl, address });
  } else if (question.type === TYPE.AAAA) {
    for (const address of ipv6) answers.push({ name: target, type: TYPE.AAAA, class: CLASS.IN, ttl, address });
  } else if (question.type === TYPE.TXT) {
    // Deliberately legible: this is what someone gets when they `dig TXT` a
    // name to find out whether the resolver, the registry, or the gateway is
    // the thing that broke.
    answers.push({
      name: target,
      type: TYPE.TXT,
      class: CLASS.IN,
      ttl,
      txt: [
        `v=moshpit1 name=${lookup.name} resolved=${lookup.resolved} ` +
          `${pointer.kind === "none" ? `gateway=${gateway.host}` : `target=${pointer.value}`}`,
      ],
    });
  } else if (question.type === TYPE.SOA) {
    answers.push(soaFor(zone, gateway, negativeTtl));
  } else if (question.type === TYPE.CNAME) {
    // The CNAME, if there is one, is already in `answers` above.
  }

  // A CNAME counts as data whatever was asked for: the client follows it. An
  // SOA alongside it would say "no such type here" and stop the follow.
  const hasData = answers.some((r) => r.type === question.type || r.type === TYPE.CNAME);
  return {
    id,
    flags: { qr: true, opcode: 0, aa: true, tc: false, rd: opts.rd, ra: true, z: false, ad: false, cd: false, rcode: 0 },
    questions: [question],
    answers,
    // NODATA (the name exists, this type does not) still needs an SOA so the
    // "no AAAA here" is cacheable.
    authorities: hasData ? [] : [soaFor(zone, gateway, negativeTtl)],
    additionals: [],
  };
}
