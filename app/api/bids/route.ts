import { NextRequest, NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { safeDomain } from "@/lib/config";
import { addBid, getAuction, highBid } from "@/lib/db";
import { dollarsToCents as parseDollarCents } from "@/lib/money";
import { fireDomainEvent } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dollars string/number → integer cents, or null if not a positive amount. */
function dollarsToCents(v: unknown): number | null {
  return parseDollarCents(v);
}

// GET /api/bids?dn= — public auction status (never leaks the reserve amount).
export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "bad domain" }, { status: 400 });
  const [auction, hb] = await Promise.all([getAuction(dn), highBid(dn)]);
  return NextResponse.json({
    dn,
    status: auction?.status ?? "open",
    buyNowCents: auction?.buy_now_cents ?? null,
    reserveSet: auction?.reserve_cents != null,
    reserveMet: auction?.reserve_cents != null && hb ? hb.amount_cents >= auction.reserve_cents : null,
    highBidCents: hb?.amount_cents ?? null,
  });
}

// POST /api/bids — register-lite (email) + place a bid on a domain.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dn = safeDomain(body.dn);
  if (!dn) return NextResponse.json({ error: "Invalid domain." }, { status: 400 });

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

  const amountCents = dollarsToCents(body.amount);
  if (amountCents == null) return NextResponse.json({ error: "Enter a bid amount." }, { status: 400 });
  if (amountCents < 100) return NextResponse.json({ error: "Minimum bid is $1." }, { status: 400 });

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : null;

  const auction = await getAuction(dn);
  if (auction?.status === "closed") {
    return NextResponse.json({ error: "This auction has been closed." }, { status: 409 });
  }
  // Must beat the current high bid (buy-now bids may equal/exceed and win).
  const hb = await highBid(dn);
  const buyNow = auction?.buy_now_cents ?? null;
  const meetsBuyNow = buyNow != null && amountCents >= buyNow;
  if (hb && amountCents <= hb.amount_cents && !meetsBuyNow) {
    return NextResponse.json(
      { error: `Bid must beat the current high bid of $${(hb.amount_cents / 100).toLocaleString()}.` },
      { status: 409 },
    );
  }

  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  try {
    const { bid, won } = await addBid({ dn, email, amountCents, message, sub: s?.sub ?? null });
    void fireDomainEvent(dn, won ? "bid.won" : "bid.placed", { dn, email, amountCents: bid.amount_cents, message });
    return NextResponse.json({
      ok: true,
      won,
      amountCents: bid.amount_cents,
      message: won
        ? "You met the buy-it-now price — the domain is yours. The owner will reach out to complete the sale."
        : "Bid placed. You'll hear from the owner if it's accepted.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not place bid." }, { status: 409 });
  }
}
