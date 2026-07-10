import { NextRequest, NextResponse } from "next/server";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { dispatchEvent } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// fire a test event to all of a project's active endpoints (needs webhook.manage)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const results = await dispatchEvent(projectId, "ping", { message: "🤘 moshcoding test event", at: new Date().toISOString() });
  return NextResponse.json({ dispatched: results.length, results });
}
