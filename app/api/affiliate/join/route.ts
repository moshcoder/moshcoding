import { NextRequest, NextResponse } from "next/server";
import { findOrCreateAccountByEmail, enrollAffiliate } from "@/lib/db";
import { safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function baseUrl(): string {
  return (process.env.APP_BASE_URL || "https://moshcoding.com").replace(/\/+$/, "");
}

/**
 * Public affiliate signup for a specific domain. Email-only — no session needed.
 * Creates a passwordless account (claimable later from the dashboard) and enrolls
 * it as an 80% affiliate, then hands back a domain-targeted referral link. That
 * link drops the 90-day first-touch `mc_ref` cookie (see middleware) so waitlist
 * signups on <dn> are credited to the affiliate.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const email = String(body?.email || "").trim().toLowerCase();
  const dn = safeDomain(body?.dn);
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (!dn) return NextResponse.json({ error: "Missing domain." }, { status: 400 });

  const account = await findOrCreateAccountByEmail(email);
  const aff = await enrollAffiliate(account.id);

  return NextResponse.json({
    ok: true,
    dn,
    code: aff.code,
    commission_pct: aff.commission_pct,
    // Domain-scoped share link: lands on <dn>'s page and sets the 90-day cookie.
    shareUrl: `${baseUrl()}/?dn=${encodeURIComponent(dn)}&ref=${encodeURIComponent(aff.code)}`,
    manageUrl: `${baseUrl()}/dashboard`,
  });
}
