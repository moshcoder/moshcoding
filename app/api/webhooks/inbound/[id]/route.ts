import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public receiver. Verifies the Standard-Webhooks signature against the
// project's stored secret and dedupes on webhook-id (idempotency).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = await req.text();

  const inbound = await db().execute({
    sql: `SELECT id, provider, secret, active FROM inbound_webhooks WHERE id = ?`,
    args: [id],
  });
  if (!inbound.rows.length || !inbound.rows[0].active) {
    return NextResponse.json({ error: "unknown receiver" }, { status: 404 });
  }
  const row: any = inbound.rows[0];

  const headers: Record<string, string | null> = {
    "webhook-id": req.headers.get("webhook-id"),
    "webhook-timestamp": req.headers.get("webhook-timestamp"),
    "webhook-signature": req.headers.get("webhook-signature"),
  };
  if (!verifyWebhook(headers, raw, String(row.secret))) {
    return NextResponse.json({ error: "signature verification failed" }, { status: 401 });
  }

  const idem = headers["webhook-id"]!;
  try {
    await db().execute({
      sql: `INSERT INTO inbound_events (inbound_id, provider, idempotency_key, status) VALUES (?, ?, ?, 'accepted')`,
      args: [row.id, row.provider, idem],
    });
  } catch {
    // UNIQUE(provider, idempotency_key) violation => already processed
    return NextResponse.json({ ok: true, duplicate: true });
  }
  // (event accepted + logged; downstream processing would hook in here)
  return NextResponse.json({ ok: true });
}
