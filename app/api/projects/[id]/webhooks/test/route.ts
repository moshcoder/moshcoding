import { NextRequest, NextResponse } from "next/server";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeProject } from "@/lib/authz";
import { testProjectWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// send a webhook.test event now to all of a project's active endpoints,
// whatever they subscribe to (needs webhook.manage)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: projectId } = await ctx.params;
  const az = await authorizeProject(u.sub, projectId, "webhook.manage");
  if (!az.ok) return bad(az.error, az.status);

  const results = await testProjectWebhooks(projectId);
  return NextResponse.json({ dispatched: results.length, results });
}
