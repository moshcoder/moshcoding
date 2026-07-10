import { NextRequest, NextResponse } from "next/server";
import { db, renameOrg, deleteOrg } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownsOrg(sub: string, id: string): Promise<boolean> {
  const r = await db().execute({ sql: `SELECT 1 FROM orgs WHERE id = ? AND owner_sub = ?`, args: [id, sub] });
  return r.rows.length > 0;
}

// rename (owner only)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsOrg(u.sub, id))) return NextResponse.json({ error: "Only the org owner can rename it." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name || name.length > 80) return bad("name required (max 80 chars)");
  await renameOrg(id, name);
  return NextResponse.json({ ok: true, id, name });
}

// delete (owner only) — cascades to teams/projects/webhooks
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsOrg(u.sub, id))) return NextResponse.json({ error: "Only the org owner can delete it." }, { status: 403 });
  await deleteOrg(id);
  return NextResponse.json({ ok: true });
}
