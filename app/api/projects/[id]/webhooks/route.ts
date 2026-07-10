import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { newSecret, isInternalUrl } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list a project's outbound webhook endpoints (secret shown only on create)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "project.read");
  if (!az.ok) return bad(az.error, az.status);
  const { rows } = await db().execute({
    sql: `SELECT id, url, events, active, created_at FROM webhook_endpoints WHERE project_id = ? ORDER BY created_at`,
    args: [projectId],
  });
  return NextResponse.json({ endpoints: rows });
}

// create an outbound endpoint (needs webhook.manage). Returns the signing secret ONCE.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!/^https?:\/\//.test(url)) return bad("a valid http(s) url is required");
  if (isInternalUrl(url)) return bad("that url points at an internal/blocked address");
  let events: string[] = ["*"];
  if (Array.isArray(body?.events) && body.events.length) events = body.events.map((e: any) => String(e));

  const secret = newSecret();
  const res = await db().execute({
    sql: `INSERT INTO webhook_endpoints (project_id, url, secret, events) VALUES (?, ?, ?, ?)
          RETURNING id, url, events, active, created_at`,
    args: [projectId, url, secret, JSON.stringify(events)],
  });
  return NextResponse.json({ endpoint: res.rows[0], secret }, { status: 201 });
}
