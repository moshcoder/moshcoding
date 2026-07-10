import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { safeDomain } from "@/lib/config";
import {
  findOrCreateAccountByEmail,
  accountOwnsDomain,
  getAuction,
  upsertAuction,
  listBids,
  highBid,
  acceptBid,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves the session to an account id: native (acct:) or CoinPay (by email). */
async function resolveAccountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

/** Dollars → integer cents; "" / null / 0 → null (clears the field). */
function dollarsToCents(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// GET /api/auctions?dn= — public status; owner also gets reserve + the bid list.
export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "bad domain" }, { status: 400 });

  const [auction, hb] = await Promise.all([getAuction(dn), highBid(dn)]);
  const accountId = await resolveAccountId(req);
  const isOwner = !!accountId && (await accountOwnsDomain(accountId, dn));

  return NextResponse.json({
    dn,
    status: auction?.status ?? "open",
    buyNowCents: auction?.buy_now_cents ?? null,
    reserveSet: auction?.reserve_cents != null,
    reserveMet: auction?.reserve_cents != null && hb ? hb.amount_cents >= auction.reserve_cents : null,
    highBidCents: hb?.amount_cents ?? null,
    isOwner,
    ...(isOwner
      ? {
          reserveCents: auction?.reserve_cents ?? null,
          acceptedBidId: auction?.accepted_bid_id ?? null,
          bids: await listBids(dn),
        }
      : {}),
  });
}

// POST /api/auctions — owner-only: set reserve/buy-now, or accept a bid.
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return NextResponse.json({ error: "Sign in to manage auctions." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dn = safeDomain(body.dn);
  if (!dn) return NextResponse.json({ error: "Invalid domain." }, { status: 400 });
  if (!(await accountOwnsDomain(accountId, dn))) {
    return NextResponse.json({ error: "You don't own this domain." }, { status: 403 });
  }

  if (body.action === "accept") {
    const bidId = String(body.bidId || "");
    const ok = await acceptBid(dn, bidId);
    if (!ok) return NextResponse.json({ error: "Bid not found." }, { status: 404 });
    return NextResponse.json({ ok: true, closed: true });
  }

  // Default action: save reserve + buy-now.
  const reserveCents = dollarsToCents(body.reserve);
  const buyNowCents = dollarsToCents(body.buyNow);
  if (reserveCents != null && buyNowCents != null && buyNowCents < reserveCents) {
    return NextResponse.json({ error: "Buy-now must be at least the reserve." }, { status: 400 });
  }
  const auction = await upsertAuction({ dn, accountId, reserveCents, buyNowCents });
  return NextResponse.json({ ok: true, auction });
}
