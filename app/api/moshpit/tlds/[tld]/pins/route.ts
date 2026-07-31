import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { PIN_KINDS, addPin, listPins, normalizePinKind, removePin } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/moshpit/tlds/:tld/pins[?kind=tls] — public; pins are public by nature. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const { tld } = await ctx.params;
  const requested = req.nextUrl.searchParams.get("kind");
  const kind = requested ? normalizePinKind(requested) : null;
  if (requested && !kind) return bad(`kind must be one of ${PIN_KINDS.join(", ")}`);

  return NextResponse.json({ tld, pins: await listPins(tld, kind) });
}

/**
 * POST /api/moshpit/tlds/:tld/pins { pin, kind, note? } — publish a key.
 *
 * Adding rather than replacing, so rotation has a window: publish the new key
 * alongside the old one, deploy it, then withdraw the old. Replacing outright
 * would break every client between the write and the deploy.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const result = await addPin({
    tld,
    pin: body?.pin,
    kind: body?.kind,
    note: body?.note,
    accountId,
  });

  // 409 when the pin is already published under a different kind: the request
  // was well formed, it just contradicts what is already there.
  if (!result.ok) return bad(result.error || "could not publish that pin", result.taken ? 409 : 400);
  return NextResponse.json({ tld, pin: body.pin, kind: body.kind }, { status: 201 });
}

/** DELETE /api/moshpit/tlds/:tld/pins?pin=... — withdraw a key. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;

  const pin = req.nextUrl.searchParams.get("pin") ?? "";
  if (!pin) return bad("pin is required");

  const result = await removePin({ tld, pin, accountId });
  if (!result.ok) return bad(result.error || "could not withdraw that pin", 404);
  return NextResponse.json({ tld, pin, withdrawn: true });
}
