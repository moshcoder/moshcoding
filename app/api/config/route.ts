import { NextRequest, NextResponse } from "next/server";
import { configFor, safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  return NextResponse.json(configFor(dn));
}
