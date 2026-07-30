import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { clearAlias, setAlias } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/moshpit/tlds/:tld/alias { to } — point .tld at another TLD you own. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await setAlias({ from: tld, to: body?.to, accountId });
  if (!result.ok) return bad(result.error || "could not set that alias");
  return NextResponse.json({ from: tld, to: body.to });
}

/** DELETE — stop pointing it anywhere. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;
  const result = await clearAlias(tld, accountId);
  if (!result.ok) return bad(result.error || "could not clear that alias");
  return NextResponse.json({ from: tld, to: null });
}
