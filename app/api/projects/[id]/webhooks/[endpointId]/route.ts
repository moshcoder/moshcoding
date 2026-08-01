import { NextRequest, NextResponse } from "next/server";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { deleteProjectWebhook, setProjectWebhookActive } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; endpointId: string }> };

export async function PATCH(req: NextRequest, ctx: Params) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId, endpointId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.active !== "boolean") {
    return bad("active must be a boolean");
  }
  const ok = await setProjectWebhookActive(endpointId, projectId, body.active);
  if (!ok) return bad("Webhook endpoint not found", 404);
  return NextResponse.json({ ok: true, id: endpointId, active: body.active });
}

export async function DELETE(req: NextRequest, ctx: Params) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId, endpointId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const ok = await deleteProjectWebhook(endpointId, projectId);
  if (!ok) return bad("Webhook endpoint not found", 404);
  return NextResponse.json({ ok: true, id: endpointId });
}
