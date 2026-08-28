import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { getClaim, finalizeClaim } from "@/lib/moshpit-claims";
import { fetchPaymentStatus, isPaidStatus, payConfigured } from "@/lib/coinpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/moshpit/claims/:id — where a paid claim got to.
 *
 * The hosted pay page returns the customer as soon as they have paid, which is
 * not the same moment the webhook arrives, so the page that greets them cannot
 * simply read the registry and report the truth. This polls the payment as a
 * fallback and finalises from here when the webhook has not landed yet —
 * without it, a confirmed payment shows as "still pending" for as long as the
 * delivery takes, which reads exactly like having lost the money.
 *
 * Scoped to the claiming account: a claim id is not a capability, and anyone
 * with one should not learn who is buying what.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const { id } = await ctx.params;
  let claim = await getClaim(id);
  if (!claim || claim.account_id !== accountId) return bad("no such claim", 404);

  if (claim.status === "pending" && claim.payment_id && payConfigured()) {
    const status = await fetchPaymentStatus(claim.payment_id);
    if (isPaidStatus(status)) {
      const result = await finalizeClaim(claim.payment_id);
      if (result.claim) claim = result.claim;
    }
  }

  return NextResponse.json({
    claim_id: claim.id,
    tld: claim.tld,
    status: claim.status,
    amount_usd: claim.amount_usd,
    expires_at: claim.expires_at,
    settled_at: claim.settled_at,
  });
}
