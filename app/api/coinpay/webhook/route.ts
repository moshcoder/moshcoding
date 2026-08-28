import { NextRequest, NextResponse } from "next/server";
import { verifyCoinPayWebhook } from "@profullstack/stack/coinpay";
import { isPaidStatus } from "@/lib/coinpay";
import { finalizeClaim } from "@/lib/moshpit-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CoinPayPortal payment webhook. Signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
// (HMAC-SHA256 over "<ts>.<rawBody>"). Idempotent.
//
// One thing is paid for here: a Moshpit ending, registered on confirmation. The
// payment id is looked up in `moshpit_tld_claims` and the event's `metadata` is
// not consulted, because metadata is only as trustworthy as the round-trip that
// echoed it — the claim row is ours and says what the money was for.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyCoinPayWebhook({
    signature: req.headers.get("x-coinpay-signature"),
    rawBody: raw,
    secret: process.env.COINPAY_WEBHOOK_SECRET || "",
  });
  if (!ok) {
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
      const claim = await finalizeClaim(String(paymentId));
      // A registration that could not complete for a reason other than the name
      // being gone is worth retrying; a refund owed is not — retrying cannot
      // make the ending available again.
      if (claim.error) {
        console.error(`coinpay webhook: claim ${claim.claim?.id} failed:`, claim.error);
        return NextResponse.json({ error: "claim failed" }, { status: 500 });
      }
      if (!claim.unknown) {
        return NextResponse.json({ ok: true, refund_due: Boolean(claim.refundDue) });
      }
    } catch (err: any) {
      console.error("coinpay webhook: claim failed:", err?.message);
      // 500 so CoinPay retries the delivery.
      return NextResponse.json({ error: "claim failed" }, { status: 500 });
    }
  }
  // Ack everything else (other event types, payments that are not ours,
  // already-processed) so it isn't retried.
  return NextResponse.json({ ok: true });
}
