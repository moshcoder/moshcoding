import { NextRequest, NextResponse } from "next/server";
import { coinpayConfigured, readSession, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { finishCoinpaySignIn, stateMatches, PENDING_COOKIES } from "@/lib/oauth";
import { requestHosts, resolveOrigin, redirectUriFor } from "@/lib/oauth-origin";
import { upsertUser, accountIdForCoinpay, linkCoinpay } from "@/lib/db";
import { acceptInviteAndNotify, INVITE_COOKIE } from "@/lib/credits";

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

function clearPending(res: NextResponse) {
  for (const name of Object.values(PENDING_COOKIES)) res.cookies.delete(name);
}

export async function GET(req: NextRequest) {
  if (!coinpayConfigured()) return new NextResponse("CoinPay login is not configured yet.", { status: 503 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return fail(sp.get("error_description") || sp.get("error")!);
  const code = sp.get("code");
  if (!code) return fail("no authorization code");
  if (!stateMatches(req.cookies.get(PENDING_COOKIES.state)?.value, sp.get("state"))) return fail("state mismatch");
  const verifier = req.cookies.get(PENDING_COOKIES.verifier)?.value;
  const nonce = req.cookies.get(PENDING_COOKIES.nonce)?.value;
  if (!verifier || !nonce) return fail("missing PKCE verifier (session expired)");
  const mode = req.cookies.get(PENDING_COOKIES.mode)?.value === "connect" ? "connect" : "login";

  // Same derivation as the authorize step, so the redirect_uri matches byte for
  // byte -- the callback arrives on whatever host that step named.
  const origin = resolveOrigin(requestHosts(req.headers), requestIsHttps(req));

  let info: { sub: string; email: string | null; name: string | null };
  try {
    info = await finishCoinpaySignIn({ code, verifier, nonce, redirectUri: redirectUriFor(origin) });
  } catch (err: any) {
    console.error("[auth] callback error:", err?.message);
    return fail("CoinPay sign-in could not be verified");
  }

  try {
    if (mode === "connect") {
      // Linking needs the password account to be signed in right now.
      const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!s?.sub?.startsWith("acct:")) return fail("sign in to your moshcoding account first");
      const r = await linkCoinpay(s.sub.slice("acct:".length), info.sub);
      const res = NextResponse.redirect(`${origin}/dashboard?coinpay=${r.ok ? "linked" : r.reason}`);
      clearPending(res);
      return res;
    }

    await upsertUser({ sub: info.sub, email: info.email, name: info.name });
    // Bound by sub; a first sign-in gets its own account (never one found by email).
    const accountId = await accountIdForCoinpay(info.sub);

    // Arrived through an invite link (/i/<code> set the cookie): accept it on
    // the account this CoinPay identity is bound to. Never blocks the sign-in.
    const invite = req.cookies.get(INVITE_COOKIE)?.value;
    let landing = `${origin}/`;
    if (invite) {
      const r = accountId ? await acceptInviteAndNotify(invite, accountId, origin).catch(() => null) : null;
      landing = `${origin}/invites?invite=${encodeURIComponent(r ? (r.ok ? r.status : r.reason) : "no_account")}`;
    }

    // Land back on the host the user started from, where the session cookie applies.
    const res = NextResponse.redirect(landing);
    res.cookies.set(SESSION_COOKIE, signSession({ sub: info.sub, email: info.email ?? null, name: info.name ?? null }), sessionCookieOptions(req));
    clearPending(res);
    if (invite) res.cookies.delete(INVITE_COOKIE);
    return res;
  } catch (err: any) {
    console.error("[auth] callback error:", err?.message);
    return fail("unexpected error");
  }
}
