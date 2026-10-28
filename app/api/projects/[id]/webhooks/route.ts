import { NextRequest, NextResponse } from "next/server";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { createProjectWebhook, isInternalUrl, listProjectWebhooks, WebhookError } from "@/lib/webhooks";
import { normalizeWebhookEventSubscriptions } from "@/lib/webhook-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list a project's outbound webhook endpoints (secret shown only on create)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "project.read");
  if (!az.ok) return bad(az.error, az.status);
  return NextResponse.json({ endpoints: await listProjectWebhooks(projectId) });
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
  const events = normalizeWebhookEventSubscriptions(body?.events);
  if (!events) {
    return bad("events must be an array of names using letters, digits, dot, underscore, colon, or dash");
  }

  try {
    const { endpoint, secret } = await createProjectWebhook(projectId, url, events);
    return NextResponse.json({ endpoint, secret }, { status: 201 });
  } catch (e) {
    if (e instanceof WebhookError) return bad(e.message, e.status);
    throw e;
  }
}
