import { NextRequest, NextResponse } from "next/server";
import { resolveAccountIdOrToken, unauthorized, bad } from "@/lib/api";
import { sendConfirmLink } from "@/lib/credits";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/invites/resend -> email the confirm link again (pending bonus only).
export async function POST(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  const ok = await sendConfirmLink(id, requestOrigin(req));
  if (!ok) return bad("Nothing to confirm.");
  return NextResponse.json({ ok: true });
}
