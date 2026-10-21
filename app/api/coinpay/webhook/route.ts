import { NextRequest, NextResponse } from "next/server";
import { verifyAndReadCoinPayWebhook } from "@profullstack/stack/coinpay";
import { finalizeClaim } from "@/lib/moshpit-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CoinPayPortal payment webhook. Signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
// (HMAC-SHA256 over "<ts>.<rawBody>"). Idempotent.
//
// One thing is paid for here: a Moshpit ending, registered on confirmation. The
// claim stores the checkout session id (`cs_...`, or a payment id for claims
// made before sessions); that id is looked up in `moshpit_tld_claims` and the
// event's `metadata` is not consulted, because metadata is only as trustworthy as the round-trip that
// echoed it — the claim row is ours and says what the money was for.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const hook = verifyAndReadCoinPayWebhook({
    signature: req.headers.get("x-coinpay-signature"),
    rawBody: raw,
    secret: process.env.COINPAY_WEBHOOK_SECRET || "",
  });
  if (!hook) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Session id first (what new claims store), then the payment id (older claims).
  // finalizeClaim is idempotent, so payment.forwarded after payment.confirmed
  // finds the claim already settled and does nothing new.
  const refs = [hook.checkoutSessionId, hook.paymentId].filter((r): r is string => Boolean(r));
  const paid = hook.paid;
  const paymentId = refs[0];

  if (paid && paymentId) {
    try {
      let claim = await finalizeClaim(paymentId);
      if (claim.unknown && refs[1]) claim = await finalizeClaim(refs[1]);
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
