import { NextRequest, NextResponse } from "next/server";
import { safeDomain } from "@/lib/config";
import { isKnownDomain, recordInboundEvent } from "@/lib/db";
import { normalizeInboundEventType } from "@/lib/webhook-events";
import { fireDomainEvent } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — self-describing so a browser hit explains what this endpoint is.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ dn: string }> }) {
  const { dn } = await ctx.params;
  const d = safeDomain(dn) || dn;
  return NextResponse.json({ ok: true, hint: `POST any JSON here to send an inbound webhook event to ${d}. View events in your moshcoding dashboard.` });
}

// POST — hosted inbound receiver for a parked domain. No owner server needed.
export async function POST(req: NextRequest, ctx: { params: Promise<{ dn: string }> }) {
  const { dn: raw } = await ctx.params;
  const dn = safeDomain(raw);
  if (!dn) return NextResponse.json({ error: "bad domain" }, { status: 400 });
  if (!(await isKnownDomain(dn))) return NextResponse.json({ error: "unknown domain" }, { status: 404 });

  const ctype = req.headers.get("content-type") || "";
  const bodyText = (await req.text().catch(() => "")).slice(0, 16000);
  const source = req.headers.get("x-webhook-source") || req.headers.get("user-agent") || null;

  // Best-effort event-type extraction from JSON payloads.
  let eventType: string | null = null;
  if (ctype.includes("json")) {
    try {
      const j = JSON.parse(bodyText);
      eventType = normalizeInboundEventType(j?.type ?? j?.event ?? j?.event_type);
    } catch { /* not json */ }
  }

  await recordInboundEvent({ dn, source, eventType, payload: bodyText });
  // Fan-in → fan-out: relay the inbound event to the domain's outbound targets.
  await fireDomainEvent(dn, `inbound.${eventType || "event"}`, { source, contentType: ctype, body: bodyText.slice(0, 4000) });

  return NextResponse.json({ ok: true });
}
