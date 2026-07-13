import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook receiver for moshcode events. Optionally HMAC-verified when
// MOSHCODE_WEBHOOK_SECRET is set (header "X-Moshcode-Signature: t=<ts>,v1=<hex>"
// over "<ts>.<rawBody>", matching the CoinPay/Standard-Webhooks scheme). When no
// secret is configured it accepts and logs (dev). Flesh out event handling once
// the payload shape is nailed down.
function verify(rawBody: string, sig: string | null): boolean {
  const secret = process.env.MOSHCODE_WEBHOOK_SECRET || "";
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!sig) return false;
  const parts: Record<string, string> = {};
  for (const kv of sig.split(",")) { const i = kv.indexOf("="); if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  if (!/^[a-f0-9]{64}$/i.test(v1)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-moshcode-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: any = {};
  try { evt = raw ? JSON.parse(raw) : {}; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  console.log("[moshcode webhook]", evt?.type || "(no type)", JSON.stringify(evt).slice(0, 500));
  // TODO: handle event types once defined (e.g. login/entitlement/usage).
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "moshcode webhook", methods: ["POST"] });
}
