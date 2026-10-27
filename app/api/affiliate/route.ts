import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { hasPaidPlan, paidUntil } from "@/lib/plan";
import { getAffiliate, enrollAffiliate, setAffiliateCommission, listReferrals, AFFILIATE_FLOOR, accountIdForCoinpay } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves the tenant account for the session: native (acct:) or CoinPay (by email). */
async function accountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  return accountIdForCoinpay(s.sub, s.email);
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL || "https://moshcoding.com").replace(/\/+$/, "");
}

async function payload(id: string) {
  const aff = await getAffiliate(id);
  if (!aff) return { affiliate: null, floor: AFFILIATE_FLOOR };
  const referrals = await listReferrals(aff.code);
  // The paid plan is on while the stored plan says so or granted days remain
  // (credit codes, invite bonuses). Once it lapses, the floor applies again.
  const paid = await hasPaidPlan(id, aff.plan);
  const until = await paidUntil(id);
  return {
    affiliate: {
      code: aff.code,
      commission_pct: paid ? aff.commission_pct : Math.max(aff.commission_pct, AFFILIATE_FLOOR),
      plan: paid ? "paid" : "free",
      paid_until: until && until > Date.now() ? new Date(until).toISOString() : null,
      shareUrl: `${baseUrl()}/signup?ref=${encodeURIComponent(aff.code)}`,
      refUrl: `${baseUrl()}/?ref=${encodeURIComponent(aff.code)}`,
    },
    referrals,
    floor: AFFILIATE_FLOOR,
  };
}

export async function GET(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ affiliate: null, floor: AFFILIATE_FLOOR });
  return NextResponse.json(await payload(id));
}

export async function POST(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body?.action === "setCommission" && body?.commission_pct !== undefined) {
    const aff = await getAffiliate(id);
    if (!aff) return NextResponse.json({ error: "Not enrolled yet." }, { status: 400 });
    if (!(await hasPaidPlan(id, aff.plan))) {
      return NextResponse.json({ error: `Free plan is floored at ${AFFILIATE_FLOOR}%. Upgrade to $1/mo, or redeem a code at /invites, to lower it.` }, { status: 403 });
    }
    const raw = body.commission_pct;
    const pct = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return NextResponse.json({ error: "commission_pct must be a number between 1 and 100." }, { status: 400 });
    }
    await setAffiliateCommission(id, pct, "paid");
  } else {
    // Default action: enroll (idempotent).
    await enrollAffiliate(id);
  }
  return NextResponse.json(await payload(id));
}
