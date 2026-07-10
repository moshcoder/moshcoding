import { NextRequest, NextResponse } from "next/server";
import { configFor, safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const dn = safeDomain(sp.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  return NextResponse.json(configFor(dn, { socials: sp.get("socials"), fallback: sp.get("fallback") }));
}
