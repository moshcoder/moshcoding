import { NextRequest, NextResponse } from "next/server";
import { renameProject, deleteProject } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// rename (member+)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  const az = await authorizeProject(u.sub, id, "project.write");
  if (!az.ok) return NextResponse.json({ error: az.error }, { status: az.status });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name || name.length > 80) return bad("name required (max 80 chars)");
  await renameProject(id, name);
  return NextResponse.json({ ok: true, id, name });
}

// delete (owner) — cascades to webhook config/history
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id } = await ctx.params;
  const az = await authorizeProject(u.sub, id, "project.delete");
  if (!az.ok) return NextResponse.json({ error: az.error }, { status: az.status });
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
