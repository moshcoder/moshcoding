import { NextRequest, NextResponse } from "next/server";
import { resolveAccountIdOrToken, unauthorized, bad } from "@/lib/api";
import { acceptInviteAndNotify, ACCEPT_MESSAGES, inviteBonusDays } from "@/lib/credits";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/invites/accept {code} -> accept an invite on this account (new accounts only).
export async function POST(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 64) : "";
  if (!code) return bad("Enter an invite code.");
  const r = await acceptInviteAndNotify(code, id, requestOrigin(req));
  if ("reason" in r) return NextResponse.json({ error: ACCEPT_MESSAGES[r.reason] || "That invite did not work.", reason: r.reason }, { status: 400 });
  return NextResponse.json({
    ok: true,
    status: r.status,
    bonus_days: r.status === "pending" ? inviteBonusDays() : 0,
    message: r.status === "pending"
      ? "Invite accepted. Check your email and confirm your address to unlock the bonus."
      : "Invite accepted. This sign-up does not qualify for the bonus.",
  });
}
