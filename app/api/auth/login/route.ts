import { NextRequest, NextResponse } from "next/server";
import { getAccountByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { authConfigured, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Accounts are not enabled yet." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  const account = await getAccountByEmail(email);
  // Generic message either way — don't reveal whether the email exists.
  const ok = account && (await verifyPassword(password, account.password_hash, account.password_salt));
  if (!account || !ok) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, status: account.status, plan: account.plan });
  res.cookies.set(SESSION_COOKIE, signSession({ sub: `acct:${account.id}`, email: account.email, name: null }), sessionCookieOptions());
  return res;
}
