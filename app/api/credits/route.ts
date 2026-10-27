import { NextRequest, NextResponse } from "next/server";
import { resolveAccountIdOrToken, unauthorized, bad } from "@/lib/api";
import { getAffiliate } from "@/lib/db";
import { hasPaidPlan, paidUntil } from "@/lib/plan";
import { redeemCode, REDEEM_MESSAGES, CREDIT_UNIT } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status(id: string) {
  const aff = await getAffiliate(id);
  const until = await paidUntil(id);
  return {
    unit: CREDIT_UNIT,
    plan: (await hasPaidPlan(id, aff?.plan)) ? "paid" : "free",
    paid_until: until && until > Date.now() ? new Date(until).toISOString() : null,
  };
}

// GET /api/credits -> the paid affiliate plan ($1/mo) and how long granted days last.
export async function GET(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  return NextResponse.json(await status(id));
}

// POST /api/credits {code} -> redeem a credit code (days of the paid plan).
export async function POST(req: NextRequest) {
  const id = await resolveAccountIdOrToken(req);
  if (!id) return unauthorized();
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 64) : "";
  if (!code) return bad("Enter a code.");
  const r = await redeemCode(code, id);
  if ("reason" in r) return NextResponse.json({ error: REDEEM_MESSAGES[r.reason] || "That code did not work.", reason: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true, days: r.days, ...(await status(id)) });
}
