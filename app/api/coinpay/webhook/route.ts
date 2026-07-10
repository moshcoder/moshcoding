import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook, isPaidStatus } from "@/lib/coinpay";
import { activateAccount } from "@/lib/db";
import { provisionTenant } from "@/lib/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CoinPayPortal payment webhook. Signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
// (HMAC-SHA256 over "<ts>.<rawBody>"). On a paid event we flip the pending
// account to active and provision its tenant page. Idempotent.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-coinpay-signature");
  if (!verifyWebhook(raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type = String(evt?.type || "");
  const data = evt?.data || {};
  const paymentId = data?.payment_id || evt?.id;
  const paid =
    isPaidStatus(data?.status) ||
    type === "payment.confirmed" || type === "payment.forwarded" || type === "payment.completed";

  if (paid && paymentId) {
    try {
      const account = await activateAccount({ paymentId: String(paymentId) });
      if (account) await provisionTenant(account);
    } catch (err: any) {
      console.error("coinpay webhook: activation failed:", err?.message);
      // 500 so CoinPay retries the delivery.
      return NextResponse.json({ error: "activation failed" }, { status: 500 });
    }
  }
  // Ack everything else (other event types, already-processed) so it isn't retried.
  return NextResponse.json({ ok: true });
}
