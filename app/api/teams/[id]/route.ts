import { NextRequest, NextResponse } from "next/server";
import { renameTeam, deleteTeam } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeTeam } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// rename (admin+)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  const az = await authorizeTeam(u.sub, id, "team.manage");
  if (!az.ok) return NextResponse.json({ error: az.error }, { status: az.status });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name || name.length > 80) return bad("name required (max 80 chars)");
  await renameTeam(id, name);
  return NextResponse.json({ ok: true, id, name });
}

// delete (owner) — cascades to projects/members/invitations
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  const az = await authorizeTeam(u.sub, id, "team.delete");
  if (!az.ok) return NextResponse.json({ error: az.error }, { status: az.status });
  await deleteTeam(id);
  return NextResponse.json({ ok: true });
}
