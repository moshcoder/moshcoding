import { NextRequest, NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { PIN_KINDS, normalizePinKind, pinsForName } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/moshpit/pins?name=scrambled.eggs[&kind=tls] — public.
 *
 * The lookup every Moshpit client makes before it will talk to anything. The
 * status codes carry meaning the body does not, because clients cache on them:
 *
 *   400  not a Moshpit name         a definite no, cacheable as long as a real answer
 *   404  no key published           also definite — the name exists, nobody vouched for a key
 *   200  { pins: [...] }            the keys a peer may present
 *
 * The distinction that matters is between those and a 5xx or a timeout. A
 * definite no means refuse the connection; an outage means try again. A client
 * that treats them alike either fails closed forever or fails open once, and
 * the second one is how pinning gets quietly defeated.
 *
 * `kind` is optional, and omitting it is safe rather than merely convenient: a
 * pin of the wrong kind can never match, since an ML-DSA SPKI hash will not
 * equal a presented TLS SPKI hash. Passing it keeps the answer honest about
 * what the name actually offers.
 */
export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!name) return bad("name is required");

  const requested = req.nextUrl.searchParams.get("kind");
  const kind = requested ? normalizePinKind(requested) : null;
  if (requested && !kind) return bad(`kind must be one of ${PIN_KINDS.join(", ")}`);

  const found = await pinsForName(name, kind);
  if (!found) return bad("not a Moshpit name");

  if (!found.pins.length) {
    return NextResponse.json(
      { name: found.name, resolved: found.resolved, tld: found.tld, pins: [] },
      { status: 404 },
    );
  }

  return NextResponse.json({
    name: found.name,
    resolved: found.resolved,
    tld: found.tld,
    // A flat array of strings first, because that is all a client needs to
    // compare against what a peer presented.
    pins: found.pins.map((p) => p.pin),
    entries: found.pins.map((p) => ({ pin: p.pin, kind: p.kind, note: p.note })),
  });
}
