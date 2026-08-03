// Which namespace a DNS query belongs to, decided before any I/O happens.
//
// This mirrors the browser extension's policy (see tronbrowser's
// `moshpit-resolve.ts`) on purpose: a user who switches from the extension to
// these resolvers should not get different answers. Two positions, same names:
//
//   'clearnet' (default) — the ordinary internet owns any name it can answer.
//       The Moshpit registry is consulted only where DNS came up empty, which
//       makes it a *backfill*. Chosen as the default because a public resolver
//       that silently redirects a domain which resolves perfectly well is
//       indistinguishable from a hijack, and nobody points their laptop at a
//       resolver expecting that.
//
//   'moshpit' — a name registered in Moshpit wins even when clearnet answers.
//       The override, for people who want the namespace they opted into.
//
// Names under a TLD the old internet has never heard of (`.moshpit`, `.eggs`)
// resolve through the registry in either mode: there is nothing to conflict
// with, and refusing them would defeat the point of running this at all.

import { CLASS, RCODE, TYPE, type Question } from "./wire";

export type ResolveMode = "clearnet" | "moshpit";

export const DEFAULT_RESOLVE_MODE: ResolveMode = "clearnet";

/**
 * TLDs never worth a registry round trip.
 *
 * `lib/moshpit-name.ts` has its own reserved list, but that one answers a
 * different question — what nobody may *claim* — and it includes `.moshpit`,
 * which is reserved precisely because we own it and it must resolve here. This
 * list is only about names the legacy root already owns, plus the special-use
 * names RFC 6761 says a resolver must not invent answers for.
 */
export const NEVER_MOSHPIT = new Set([
  "com", "net", "org", "edu", "gov", "mil", "int", "arpa", "info", "biz", "io", "co",
  "localhost", "local", "onion", "test", "invalid", "example", "home", "internal", "lan",
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The Moshpit name a query is asking about, or null when it is not asking
 * about one.
 *
 * The registry namespace is one level deep — `scrambled.eggs` — but DNS
 * queries under it are not: browsers ask for `www.scrambled.eggs`, and mail
 * clients ask for `_dmarc.scrambled.eggs`. So the *last two labels* are the
 * name, and anything to the left is a subdomain of it that the gateway sorts
 * out by Host header.
 */
export function moshpitCandidate(qname: string): { name: string; label: string; tld: string; prefix: string } | null {
  const host = String(qname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":")) return null;
  // An address literal is not a name, and `1.2.3.4` must never be read as
  // `3.4` in the Moshpit namespace.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;

  const parts = host.split(".");
  if (parts.length < 2) return null;
  const tld = parts[parts.length - 1];
  const label = parts[parts.length - 2];
  if (NEVER_MOSHPIT.has(tld)) return null;
  // A name whose every label is a number is address-shaped, and reading
  // `10.0.0.1` or `192.168` as a name in this namespace would let anyone who
  // registered `.1` intercept traffic meant for a machine. A *numeric ending*
  // under a real label is a different thing: `.2600` is a registered ending,
  // and `alt.2600` can only ever be a name. Rejecting the whole class here
  // meant the registry sold endings the resolver then refused to resolve.
  //
  // The registry still decides whether the name exists. This is only the shape
  // filter, and it should exclude what can never be a name rather than what
  // merely looks unusual.
  if (parts.every((part) => /^\d+$/.test(part))) return null;
  if (tld.length < 2) return null;
  if (!LABEL.test(tld) || !LABEL.test(label)) return null;
  // Underscore-prefixed service labels (`_dmarc`, `_acme-challenge`) are legal
  // in DNS but never a registry label, so they can only be a prefix.
  const prefix = parts.slice(0, parts.length - 2).join(".");
  return { name: `${label}.${tld}`, label, tld, prefix };
}

export type QueryPlan =
  /** Answer nothing useful, with this rcode. */
  | { action: "refuse"; rcode: number; reason: string }
  /** Not a Moshpit name: hand it straight to the upstream resolvers. */
  | { action: "forward"; reason: string }
  /** Ask the registry first; fall back to upstream if the name is unregistered. */
  | { action: "moshpit-first"; name: string; reason: string }
  /** Ask upstream first; consult the registry only if clearnet has no answer. */
  | { action: "forward-first"; name: string; reason: string };

/**
 * Decide what to do with one question. Pure and total: every input produces a
 * plan, so the server never has to invent behaviour for a case nobody thought
 * about, and the whole policy is testable without a socket.
 */
export function planQuery(opts: {
  question: Question;
  /** Recursion Desired, from the query header. */
  rd: boolean;
  opcode?: number;
  questionCount?: number;
  mode?: ResolveMode;
}): QueryPlan {
  const { question, rd } = opts;
  const mode = opts.mode ?? DEFAULT_RESOLVE_MODE;

  if ((opts.opcode ?? 0) !== 0) {
    return { action: "refuse", rcode: RCODE.NOTIMP, reason: "only standard queries are implemented" };
  }
  if ((opts.questionCount ?? 1) !== 1) {
    return { action: "refuse", rcode: RCODE.FORMERR, reason: "expected exactly one question" };
  }
  if (question.class !== CLASS.IN) {
    return { action: "refuse", rcode: RCODE.REFUSED, reason: "only the IN class is served" };
  }
  // ANY is the classic reflection amplifier: a tiny query, a huge answer, and a
  // forged source address. Nothing legitimate needs it from a public resolver.
  if (question.type === TYPE.ANY) {
    return { action: "refuse", rcode: RCODE.REFUSED, reason: "ANY queries are not served" };
  }

  const candidate = moshpitCandidate(question.name);

  if (!candidate) {
    if (!rd) {
      // No recursion desired and nothing we are authoritative for. Forwarding
      // it anyway would make this an open cache to probe; refusing is what a
      // forwarder is supposed to say.
      return { action: "refuse", rcode: RCODE.REFUSED, reason: "recursion is required for clearnet names" };
    }
    return { action: "forward", reason: "not a Moshpit name" };
  }

  // A Moshpit name is data we serve ourselves, so RD=0 is answerable — but
  // only from the registry, since the fallback half needs recursion.
  if (!rd) {
    return { action: "moshpit-first", name: candidate.name, reason: "authoritative answer without recursion" };
  }

  if (mode === "moshpit") {
    return { action: "moshpit-first", name: candidate.name, reason: "Moshpit overrides clearnet in moshpit mode" };
  }
  return { action: "forward-first", name: candidate.name, reason: "clearnet first, Moshpit backfills" };
}

/**
 * Did the upstream answer actually resolve the name?
 *
 * NXDOMAIN is the obvious no. NOERROR with an empty answer section (NODATA)
 * is the subtle one: the name exists in clearnet but has no address, e.g. a
 * parked domain with only an MX. Treating that as "clearnet answered" would
 * strand a Moshpit name behind a clearnet placeholder, so an address query
 * with no addresses counts as no answer.
 */
export function clearnetAnswered(response: {
  flags?: { rcode?: number };
  answers?: Array<{ type: number }>;
  questions?: Question[];
}): boolean {
  const rcode = response?.flags?.rcode ?? RCODE.NOERROR;
  if (rcode === RCODE.NXDOMAIN) return false;
  if (rcode !== RCODE.NOERROR) return true; // SERVFAIL and friends: not ours to override
  return (response?.answers?.length ?? 0) > 0;
}
