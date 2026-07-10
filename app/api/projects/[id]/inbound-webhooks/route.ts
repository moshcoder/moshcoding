import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { newSecret } from "@/lib/webhooks";
import { APP_BASE_URL } from "@/lib/oauth";

const APP_BASE_URL_SAFE = () => APP_BASE_URL;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list inbound webhook receivers configured for a project
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "project.read");
  if (!az.ok) return bad(az.error, az.status);
  const { rows } = await db().execute({
    sql: `SELECT id, provider, active, created_at FROM inbound_webhooks WHERE project_id = ? ORDER BY created_at`,
    args: [projectId],
  });
  const receivers = (rows as any[]).map((r) => ({ ...r, url: `${APP_BASE_URL_SAFE()}/api/webhooks/inbound/${r.id}` }));
  return NextResponse.json({ receivers });
}

// create an inbound receiver for a provider; returns the shared secret ONCE + the URL
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const body = await req.json().catch(() => ({}));
  const provider = String(body?.provider || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(provider)) return bad("provider must be 2-40 chars [a-z0-9_-]");

  const secret = newSecret("whrcv_");
  try {
    const res = await db().execute({
      sql: `INSERT INTO inbound_webhooks (project_id, provider, secret) VALUES (?, ?, ?)
            RETURNING id, provider, active, created_at`,
      args: [projectId, provider, secret],
    });
    const r: any = res.rows[0];
    return NextResponse.json({ receiver: { ...r, url: `${APP_BASE_URL_SAFE()}/api/webhooks/inbound/${r.id}` }, secret }, { status: 201 });
  } catch {
    return bad("that provider already has a receiver on this project", 409);
  }
}
