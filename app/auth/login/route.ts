import { NextRequest, NextResponse } from "next/server";
import { coinpayConfigured, readSession, SESSION_COOKIE } from "@/lib/session";
import { makePkce, authorizeUrl, PENDING_COOKIES } from "@/lib/oauth";
import { requestHosts, resolveOrigin, redirectUriFor } from "@/lib/oauth-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestIsHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  return req.nextUrl.protocol === "https:" || (process.env.APP_BASE_URL || "").startsWith("https://");
}

/**
 * Starts "Sign in with CoinPay". `?mode=connect` links CoinPay to the password
 * account that is signed in right now, so it needs that session; it is the
 * only way a CoinPay identity joins an existing account (never by email).
 */
export async function GET(req: NextRequest) {
  if (!coinpayConfigured()) {
    return new NextResponse("CoinPay login is not configured yet.", { status: 503 });
  }
  const mode = req.nextUrl.searchParams.get("mode") === "connect" ? "connect" : "login";
  if (mode === "connect") {
    const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!s?.sub?.startsWith("acct:")) {
      return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
    }
  }
  const secure = requestIsHttps(req);
  // Send the IdP back to the host the user is actually on, so the host-only
  // pending cookies set below are still readable at the callback.
  const origin = resolveOrigin(requestHosts(req.headers), secure);
  const { verifier, challenge, state, nonce } = makePkce();
  const res = NextResponse.redirect(authorizeUrl(challenge, state, redirectUriFor(origin), nonce));
  const opts = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  res.cookies.set(PENDING_COOKIES.verifier, verifier, opts);
  res.cookies.set(PENDING_COOKIES.state, state, opts);
  res.cookies.set(PENDING_COOKIES.nonce, nonce, opts);
  res.cookies.set(PENDING_COOKIES.mode, mode, opts);
  return res;
}
