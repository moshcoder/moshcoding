import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, unauthorized } from "@/lib/api";
import { coinpayLinkStatus, getAccountById, unlinkCoinpay } from "@/lib/db";
import { coinpayConfigured, readSession, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CoinPay link status for the dashboard's Connect / Disconnect card. */
export async function GET(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();
  return NextResponse.json({ enabled: coinpayConfigured(), ...(await coinpayLinkStatus(id)) });
}

/** Disconnect CoinPay. Refused when it is the account's only way to sign in. */
export async function DELETE(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();
  const r = await unlinkCoinpay(id);
  if (!r.ok) {
    const error = r.reason === "only_login"
      ? "CoinPay is the only way into this account, so it cannot be disconnected."
      : "CoinPay is not connected.";
    return NextResponse.json({ error }, { status: 409 });
  }
  const res = NextResponse.json({ ok: true });
  // A session that was a CoinPay sign-in would otherwise resolve to a fresh
  // CoinPay-only account on the next request: move it onto the account itself.
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s && !s.sub.startsWith("acct:")) {
    const acct = await getAccountById(id);
    res.cookies.set(SESSION_COOKIE, signSession({ sub: `acct:${id}`, email: acct?.email ?? null, name: s.name ?? null }), sessionCookieOptions(req));
  }
  return res;
}
