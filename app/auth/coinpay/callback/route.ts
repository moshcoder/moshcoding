import { NextRequest, NextResponse } from "next/server";
import { coinpayConfigured, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { exchangeCode, fetchUserinfo } from "@/lib/oauth";
import { requestHosts, resolveOrigin, redirectUriFor } from "@/lib/oauth-origin";
import { upsertUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(msg: string) {
  return new NextResponse(`Login failed: ${msg}`, { status: 400 });
}

function requestIsHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  return req.nextUrl.protocol === "https:" || (process.env.APP_BASE_URL || "").startsWith("https://");
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

  // Same derivation as the authorize step, so the redirect_uri matches byte for
  // byte -- the callback arrives on whatever host that step named.
  const origin = resolveOrigin(requestHosts(req.headers), requestIsHttps(req));

  try {
    const tokens = await exchangeCode(code, verifier, redirectUriFor(origin));
    const info = await fetchUserinfo(tokens.access_token);
    if (!info?.sub) return fail("no subject in userinfo");
    await upsertUser({ sub: info.sub, email: info.email, name: info.name });

    // Land back on the host the user started from, where the session cookie applies.
    const res = NextResponse.redirect(`${origin}/`);
    res.cookies.set(SESSION_COOKIE, signSession({ sub: info.sub, email: info.email ?? null, name: info.name ?? null }), sessionCookieOptions(req));
    res.cookies.delete("cp_pkce");
    res.cookies.delete("cp_state");
    return res;
  } catch (err: any) {
    console.error("[auth] callback error:", err?.message);
    return fail("unexpected error");
  }
}
