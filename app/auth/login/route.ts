import { NextResponse } from "next/server";
import { coinpayConfigured } from "@/lib/session";
import { makePkce, authorizeUrl } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!coinpayConfigured()) {
    return new NextResponse("CoinPay login is not configured yet.", { status: 503 });
  }
  const { verifier, challenge, state } = makePkce();
  const res = NextResponse.redirect(authorizeUrl(challenge, state));
  const secure = (process.env.APP_BASE_URL || "").startsWith("https://");
  const opts = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  res.cookies.set("cp_pkce", verifier, opts);
  res.cookies.set("cp_state", state, opts);
  return res;
}
