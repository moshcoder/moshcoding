import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { getAccountById } from "@/lib/db";
import { listTlds, listTldsForAccount, registerTld } from "@/lib/moshpit";
import { openClaim, attachPayment, abandonClaim } from "@/lib/moshpit-claims";
import {
  payConfigured,
  createClaimPayment,
  claimPriceUsd,
  formatUsd,
  payUrl,
  CLAIM_PRICE_USD,
  CLAIM_HOLD_MINUTES,
} from "@/lib/coinpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/moshpit/tlds — the public registry, or `?mine=1` for yours. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("mine")) {
    const accountId = await resolveAccountId(req);
    if (!accountId) return unauthorized();
    return NextResponse.json({ tlds: await listTldsForAccount(accountId) });
  }
  return NextResponse.json({ tlds: await listTlds() });
}

/**
 * POST /api/moshpit/tlds — claim `.<whatever>`. First writer wins.
 *
 * With payments configured this does not register anything. It reserves the
 * ending, creates a payment, and answers 402 with somewhere to pay; the
 * registration happens in the webhook once the money confirms. Returning the
 * name as claimed here and reconciling later would mean handing out endings
 * that were never paid for, and taking them back afterwards.
 *
 * Without a payment key it registers immediately, exactly as before — that is
 * local development and the test suite, not a way to skip the charge in
 * production, where the key is what makes the site able to charge at all.
 */
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const account = await getAccountById(accountId);

  if (!payConfigured()) {
    const result = await registerTld({
      tld: body?.tld,
      accountId,
      ownerEmail: account?.email ?? null,
      ownerKey: typeof body?.owner_key === "string" ? body.owner_key : null,
    });

    // 409 rather than 400 when the name is gone: the request was well formed,
    // someone else simply got there first, and a client should be able to tell
    // those apart without parsing the message.
    if (!result.ok) return bad(result.error || "could not register that TLD", result.taken ? 409 : 400);
    return NextResponse.json({ tld: result.tld }, { status: 201 });
  }

  let price: number;
  try {
    price = claimPriceUsd();
  } catch (err: any) {
    // A misconfigured price must not be charged or guessed at.
    console.error("moshpit claim: MOSHPIT_CLAIM_PRICE_USD is unusable:", err?.message);
    return bad("claiming is temporarily unavailable", 503);
  }

  const reserved = await openClaim({
    tld: body?.tld,
    accountId,
    ownerEmail: account?.email ?? null,
    amountUsd: formatUsd(price),
    holdMinutes: CLAIM_HOLD_MINUTES,
  });
  if (!reserved.ok || !reserved.claim) {
    return bad(reserved.error || "could not reserve that TLD", reserved.taken ? 409 : 400);
  }
  const claim = reserved.claim;

  // Re-entering an unfinished checkout returns the same payment rather than a
  // second one: the hold is already this account's, and charging twice for one
  // ending is worse than any duplicate-click handling is worth.
  if (claim.payment_id) {
    return NextResponse.json(
      {
        payment_required: true,
        tld: claim.tld,
        claim_id: claim.id,
        payment_id: claim.payment_id,
        amount_usd: claim.amount_usd,
        pay_url: payUrl(claim.payment_id),
        expires_at: claim.expires_at,
      },
      { status: 402 },
    );
  }

  const base = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, "");
  let payment;
  try {
    payment = await createClaimPayment({
      claimId: claim.id,
      accountId,
      email: account?.email ?? null,
      tld: claim.tld,
      amount: CLAIM_PRICE_USD,
      holdMinutes: CLAIM_HOLD_MINUTES,
      redirectUrl: `${base}/pit?claim=${encodeURIComponent(claim.id)}`,
    });
  } catch (err: any) {
    // Free the ending immediately. Leaving the hold to expire would park a name
    // nobody is paying for, for the full hold window, over our own outage.
    await abandonClaim(claim.id);
    console.error("moshpit claim: could not create payment:", err?.message);
    return bad("could not start a payment for that TLD", 502);
  }

  await attachPayment(claim.id, payment.id);

  return NextResponse.json(
    {
      payment_required: true,
      tld: claim.tld,
      claim_id: claim.id,
      payment_id: payment.id,
      amount_usd: claim.amount_usd,
      pay_url: payment.payUrl,
      expires_at: claim.expires_at,
    },
    { status: 402 },
  );
}
