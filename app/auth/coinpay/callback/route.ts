import { NextRequest, NextResponse } from "next/server";
import { coinpayConfigured, signSession, SESSION_COOKIE, SESSION_TTL } from "@/lib/session";
import { exchangeCode, fetchUserinfo, APP_BASE_URL } from "@/lib/oauth";
import { upsertUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(msg: string) {
  return new NextResponse(`Login failed: ${msg}`, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (!coinpayConfigured()) return new NextResponse("CoinPay login is not configured yet.", { status: 503 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail(sp.get("error_description") || sp.get("error")!);
  const code = sp.get("code");
  if (!code) return fail("no authorization code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("cp_state")?.value;
  if (!state || state !== cookieState) return fail("state mismatch");
  const verifier = req.cookies.get("cp_pkce")?.value;
  if (!verifier) return fail("missing PKCE verifier (session expired)");

  try {
    const tokens = await exchangeCode(code, verifier);
    const info = await fetchUserinfo(tokens.access_token);
    if (!info?.sub) return fail("no subject in userinfo");
    await upsertUser({ sub: info.sub, email: info.email, name: info.name });

    const res = NextResponse.redirect(`${APP_BASE_URL}/`);
    const secure = APP_BASE_URL.startsWith("https://");
    res.cookies.set(SESSION_COOKIE, signSession({ sub: info.sub, email: info.email ?? null, name: info.name ?? null }), {
      httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL,
    });
    res.cookies.delete("cp_pkce");
    res.cookies.delete("cp_state");
    return res;
  } catch (err: any) {
    console.error("[auth] callback error:", err?.message);
    return fail("unexpected error");
  }
}
