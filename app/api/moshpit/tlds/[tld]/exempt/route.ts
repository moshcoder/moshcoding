import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { clearExempt, listExempt, setExempt } from "@/lib/moshpit";
import { normalizeTld } from "@/lib/moshpit-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the names held back from this TLD's alias. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const { tld } = await ctx.params;
  const name = normalizeTld(tld);
  if (!name) return bad("not a valid TLD");
  return NextResponse.json({ tld: name, exempt: await listExempt(name) });
}

/** POST { label } — keep label.tld where it is, ignoring the alias. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await setExempt({ tld, label: body?.label, accountId });
  if (!result.ok) return bad(result.error || "could not exempt that name");
  return NextResponse.json({ tld, label: body.label, exempt: true }, { status: 201 });
}

/** DELETE { label } — let it follow the alias again. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { tld } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await clearExempt({ tld, label: body?.label, accountId });
  if (!result.ok) return bad(result.error || "could not clear that exemption");
  return NextResponse.json({ tld, label: body.label, exempt: false });
}
