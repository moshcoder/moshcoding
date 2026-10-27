import { NextRequest, NextResponse } from "next/server";
import { confirmInvite } from "@/lib/credits";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /i/confirm?t=<signed token> -> the invitee confirmed their email: pay the bonus once.
// Works in any browser (no session needed): the token names the account and address.
export async function GET(req: NextRequest) {
  const r = await confirmInvite(req.nextUrl.searchParams.get("t") || "");
  const to = new URL("/invites", requestOrigin(req));
  if ("reason" in r) to.searchParams.set("confirm_error", r.reason);
  else to.searchParams.set("confirmed", String(r.days));
  return NextResponse.redirect(to, 303);
}
