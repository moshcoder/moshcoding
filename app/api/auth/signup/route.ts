import { NextRequest, NextResponse } from "next/server";
import { hashPassword, passwordProblem } from "@/lib/password";
import { createAccount, getAccountByEmail, setAccountPayment, activateAccount, isAdminEmail } from "@/lib/db";
import { safeDomain, normalizeHandle } from "@/lib/config";
import { authConfigured, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { payConfigured, createSetupPayment } from "@/lib/coinpay";
import { provisionTenant } from "@/lib/provision";
import { APP_BASE_URL } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Known social platforms we accept a handle for at signup. */
const PLATFORMS = ["x", "bluesky", "instagram", "tiktok", "github", "youtube"];

function cleanWallet(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const w = v.trim();
  if (!w) return null;
  return /^[a-zA-Z0-9:._-]{6,128}$/.test(w) ? w : null;
}

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Accounts are not enabled yet." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
  }
  const pwProblem = passwordProblem(body?.password);
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

  const domain = safeDomain(body?.domain);
  if (!domain) return NextResponse.json({ error: "Enter a valid domain name." }, { status: 400 });

  // Collect socials — either a { platform: handle } object or flat fields.
  const rawHandles = (body?.handles && typeof body.handles === "object") ? body.handles : body;
  const handles: Record<string, string> = {};
  for (const p of PLATFORMS) {
    const h = normalizeHandle(rawHandles?.[p]);
    if (h) handles[p] = h;
  }
  const payoutWallet = cleanWallet(body?.payoutWallet ?? body?.payout_wallet);
  const payoutChain = typeof body?.payoutChain === "string" ? body.payoutChain.trim().slice(0, 24) : null;
  // Explicit ?ref in the request, else the first-touch mc_ref cookie (90 days).
  const rawRef = (typeof body?.ref === "string" && body.ref) || req.cookies.get("mc_ref")?.value || "";
  const ref = String(rawRef).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || null;

  if (await getAccountByEmail(email)) {
    return NextResponse.json({ error: "An account with that email already exists. Try logging in." }, { status: 409 });
  }

  const { hash, salt } = await hashPassword(String(body.password));
  let account;
  try {
    account = await createAccount({
      email, passwordHash: hash, passwordSalt: salt,
      domain, handles, payoutWallet, payoutChain, ref,
    });
  } catch (err: any) {
    // Unique-email race.
    if (/unique/i.test(String(err?.message))) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    console.error("signup: createAccount failed:", err?.message);
    return NextResponse.json({ error: "Couldn't create the account. Try again." }, { status: 500 });
  }

  // Log the new account in immediately (as a pending account) so the dashboard
  // can show payment status.
  const setCookie = (res: NextResponse) => {
    res.cookies.set(SESSION_COOKIE, signSession({ sub: `acct:${account.id}`, email, name: null }), sessionCookieOptions());
    return res;
  };

  // Admins never pay — activate + provision immediately.
  if (isAdminEmail(email)) {
    const active = await activateAccount({ accountId: account.id });
    if (active) await provisionTenant(active);
    return setCookie(NextResponse.json({ ok: true, pending: false, activated: true, admin: true, redirect: "/dashboard" }));
  }

  // Charge the $1 setup fee via CoinPay, then provision on webhook confirmation.
  if (payConfigured()) {
    try {
      const payment = await createSetupPayment({
        accountId: account.id, email, domain,
        redirectUrl: `${APP_BASE_URL}/dashboard?welcome=1`,
      });
      await setAccountPayment(account.id, payment.id);
      return setCookie(NextResponse.json({ ok: true, pending: true, payUrl: payment.payUrl }));
    } catch (err: any) {
      console.error("signup: coinpay payment failed:", err?.message);
      return setCookie(NextResponse.json(
        { error: "Account created, but starting the $1 checkout failed. Retry from your dashboard.", pending: true, payFailed: true },
        { status: 502 },
      ));
    }
  }

  // No payment configured (local dev / not yet provisioned): activate + provision
  // immediately so the flow is testable end to end.
  const active = await activateAccount({ accountId: account.id });
  if (active) await provisionTenant(active);
  return setCookie(NextResponse.json({ ok: true, pending: false, activated: true, redirect: "/dashboard" }));
}
