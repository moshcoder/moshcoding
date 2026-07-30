import { NextRequest, NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { resolveMoshpitName } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/moshpit/resolve?name=foo.agentic
 *
 * The lookup a resolver makes. Unauthenticated by design: resolution is the
 * public half of a namespace, and a name that only resolves for signed-in
 * callers is not a name.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return bad("name is required, e.g. ?name=foo.agentic");
  const result = await resolveMoshpitName(name);
  if (!result) return bad("not a valid moshpit name — expected one label and one TLD, e.g. foo.agentic");
  return NextResponse.json(result);
}
