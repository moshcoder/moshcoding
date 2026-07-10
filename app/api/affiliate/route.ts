import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { getAffiliate, enrollAffiliate, setAffiliateCommission, listReferrals, AFFILIATE_FLOOR, findOrCreateAccountByEmail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves the tenant account for the session: native (acct:) or CoinPay (by email). */
async function accountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL || "https://moshcoding.com").replace(/\/+$/, "");
}

async function payload(id: string) {
  const aff = await getAffiliate(id);
  if (!aff) return { affiliate: null, floor: AFFILIATE_FLOOR };
  const referrals = await listReferrals(aff.code);
  return {
    affiliate: {
      code: aff.code,
      commission_pct: aff.commission_pct,
      plan: aff.plan,
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
    if (aff.plan !== "paid") {
      return NextResponse.json({ error: `Free plan is floored at ${AFFILIATE_FLOOR}%. Upgrade to $1/mo to lower it.` }, { status: 403 });
    }
    await setAffiliateCommission(id, Number(body.commission_pct));
  } else {
    // Default action: enroll (idempotent).
    await enrollAffiliate(id);
  }
  return NextResponse.json(await payload(id));
}
