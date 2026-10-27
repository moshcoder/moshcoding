import { NextRequest, NextResponse } from "next/server";
import { resolveAccountIdOrToken, unauthorized, bad } from "@/lib/api";
import { getAccountById } from "@/lib/db";
import { affiliates, canSendInvites, inviteBonusDays, inviteBonusFor } from "@/lib/credits";
import { requestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

// GET /api/invites -> quota, the invites you made, your own bonus status.
export async function GET(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  const acct = await getAccountById(id);
  if (!acct) return unauthorized();
  const aff = affiliates();
  const [quota, invites, bonus, send] = await Promise.all([
    aff.quota(id), aff.invites(id), inviteBonusFor(id), canSendInvites(acct),
  ]);
  return NextResponse.json({
    quota,
    bonus_days: inviteBonusDays(),
    can_send: send.ok,
    send_error: "error" in send ? send.error : null,
    my_bonus: bonus,
    invites: invites.map((i) => ({
      id: i.id,
      note: i.note,
      created_at: iso(i.createdAt),
      expires_at: iso(i.expiresAt),
      used: Boolean(i.usedBy),
      used_at: iso(i.usedAt),
      revoked: Boolean((i as any).revokedAt),
    })),
  });
}

// POST /api/invites {note?} -> a new invite link (shown once).
export async function POST(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  const acct = await getAccountById(id);
  if (!acct) return unauthorized();
  const send = await canSendInvites(acct);
  if ("error" in send) return bad(send.error, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 80) : "";
  try {
    const invite = await affiliates().createInvite(id, note);
    return NextResponse.json({
      code: invite.code,
      link: `${requestOrigin(req)}/i/${invite.code}`,
      expires_at: iso(invite.expiresAt),
      left: (await affiliates().quota(id)).left,
    }, { status: 201 });
  } catch (err: any) {
    if (/no invites left/i.test(String(err?.message))) return bad("You have no invites left.", 403);
    throw err;
  }
}
