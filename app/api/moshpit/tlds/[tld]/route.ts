import { NextRequest, NextResponse } from "next/server";
import { getTld, normalizeTld, tldRejection } from "@/lib/moshpit";
import { openClaimForTld } from "@/lib/moshpit-claims";
import { payConfigured, claimPriceUsd, formatUsd } from "@/lib/coinpay";

/**
 * What claiming costs, when it costs anything.
 *
 * Sent with every availability answer so the page can price the button before
 * anyone commits to it — being told the number only after clicking "Claim" and
 * landing on a checkout is how a free-looking action turns into a surprise.
 */
function priceFields() {
  if (!payConfigured()) return { price_usd: null, currency: null };
  try {
    return { price_usd: formatUsd(claimPriceUsd()), currency: process.env.COINPAY_PAY_CHAIN || "USDC_POL" };
  } catch {
    return { price_usd: null, currency: null };
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/moshpit/tlds/:tld — availability lookup, no auth.
 *
 * This is what a registration page calls as you type, and what a resolver calls
 * to find out who owns a name, so it answers for every case rather than 404ing
 * on "not registered" — unregistered is a legitimate answer here.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const { tld: raw } = await ctx.params;
  const tld = normalizeTld(raw);
  if (!tld) {
    return NextResponse.json(
      { tld: raw, available: false, reason: "not a valid TLD — letters, digits and dashes only, no dots" },
      { status: 400 },
    );
  }

  const reserved = tldRejection(tld);
  if (reserved) return NextResponse.json({ tld, available: false, reason: reserved });

  const price = priceFields();

  const owned = await getTld(tld);
  if (owned) {
    // Deliberately not the owning account id — ownership is public, the
    // account behind it is not.
    return NextResponse.json({
      tld,
      available: false,
      reason: "already registered",
      registered_at: owned.created_at,
      ...price,
    });
  }

  // A name someone is mid-payment for is not available, and saying "free" here
  // would send a second buyer to a checkout that cannot complete.
  const held = await openClaimForTld(tld);
  if (held) {
    return NextResponse.json({
      tld,
      available: false,
      reason: "someone is paying for it right now",
      held_until: held.expires_at,
      ...price,
    });
  }

  return NextResponse.json({ tld, available: true, ...price });
}
