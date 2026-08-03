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

/**
 * Two-label endings that are registry boundaries in the legacy root, not names.
 *
 * The Moshpit namespace is one level deep, so the *last two labels* of a query
 * are the name — which is right for `www.scrambled.eggs` and wrong for
 * `www.bbc.co.uk`, where the last two labels are `co.uk`. That read the BBC as
 * a name in this namespace: a registry lookup on every UK page load, and in
 * `moshpit` mode, whoever registered `co.uk` would have intercepted every site
 * under it.
 *
 * A bundled list goes stale — the same objection `roots.ts` raises — but this
 * one ages far better than a gTLD list: ccTLD second levels change on the order
 * of years, and being wrong costs one needless lookup rather than a wrong
 * answer. It is not the full Public Suffix List, just the endings a browser is
 * likely to meet.
 */
export const PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "lg.jp",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "co.za", "org.za", "web.za", "gov.za", "ac.za",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "edu.in",
  "co.kr", "or.kr", "ne.kr", "go.kr", "re.kr",
  "com.mx", "org.mx", "gob.mx", "edu.mx",
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr",
  "com.tw", "org.tw", "gov.tw", "edu.tw",
  "com.sg", "net.sg", "org.sg", "gov.sg", "edu.sg",
  "com.hk", "org.hk", "gov.hk", "edu.hk", "idv.hk",
  "com.ar", "com.co", "com.pe", "com.uy", "com.ec", "com.ve",
  "com.ua", "com.pl", "com.ru", "com.es", "com.pt", "com.gr", "com.cy",
  "com.vn", "com.my", "com.ph", "com.pk", "com.bd", "com.np",
  "com.eg", "com.sa", "com.ng", "com.gh", "com.kw", "com.qa",
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
  // `co.uk` is where names start, not a name. See PUBLIC_SUFFIXES.
  if (PUBLIC_SUFFIXES.has(`${label}.${tld}`)) return null;
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
 * NXDOMAIN is the obvious no: clearnet has never heard of the name, so the
 * registry gets a turn. NOERROR with records is the obvious yes.
 *
 * NOERROR with an empty answer section (NODATA) is the subtle one, and reading
 * it as "clearnet has nothing" — which this used to do, for every query type —
 * is what made the ordinary web slow.
 *
 * NODATA is a *positive* statement about the name: the zone exists and was
 * asked, it simply holds no record of this type. It is also the common case,
 * not the rare one. A browser asks A, AAAA and HTTPS (type 65) for every
 * hostname it touches, and the vast majority of real domains have no AAAA and
 * no HTTPS record — so two queries in three came back NODATA, were read as
 * "clearnet came up empty", and paid for a registry round trip plus a root
 * probe before the browser got its answer. Worse than slow: where the registry
 * happened to hold that name, a legitimate domain's AAAA was answered with the
 * *gateway's* address, and a dual-stack client went to the pit instead of the
 * site it asked for.
 *
 * So NODATA now counts as an answer, with one exception kept deliberately: an
 * `A` query with no addresses. That is the case the original note was about — a
 * name that exists in clearnet with only an MX behind it, where backfilling
 * from the registry is the useful thing to do — and it is genuinely rare, so it
 * costs a lookup almost nowhere. Every other type is left to clearnet, which is
 * the one that actually knows.
 */
export function clearnetAnswered(response: {
  flags?: { rcode?: number };
  answers?: Array<{ type: number }>;
  questions?: Question[];
}): boolean {
  const rcode = response?.flags?.rcode ?? RCODE.NOERROR;
  if (rcode === RCODE.NXDOMAIN) return false;
  if (rcode !== RCODE.NOERROR) return true; // SERVFAIL and friends: not ours to override
  if ((response?.answers?.length ?? 0) > 0) return true;

  // NODATA. Only an address query with no address leaves room for a backfill;
  // an unknown question type is left alone, because inventing an answer for a
  // type we did not understand is how a resolver breaks things it never saw.
  return response?.questions?.[0]?.type !== TYPE.A;
}
