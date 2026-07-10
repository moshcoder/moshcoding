import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { getAccountById, updateAccountProfile } from "@/lib/db";
import { normalizeHandle } from "@/lib/config";
import { payUrl } from "@/lib/coinpay";
import { provisionTenant } from "@/lib/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS = ["x", "bluesky", "instagram", "tiktok", "github", "youtube"];

function accountId(req: NextRequest): string | null {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s?.sub?.startsWith("acct:")) return null;
  return s.sub.slice("acct:".length);
}

function cleanWallet(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const w = v.trim();
  if (!w) return null;
  return /^[a-zA-Z0-9:._-]{6,128}$/.test(w) ? w : null;
}

function view(acct: any) {
  return {
    email: acct.email,
    domain: acct.domain,
    handles: acct.handles,
    payout_wallet: acct.payout_wallet,
    payout_chain: acct.payout_chain,
    plan: acct.plan,
    status: acct.status,
    pageUrl: acct.domain ? `/?dn=${encodeURIComponent(acct.domain)}` : null,
    // Let a pending account resume its $1 checkout.
    payUrl: acct.status === "pending" && acct.coinpay_payment_id ? payUrl(acct.coinpay_payment_id) : null,
  };
}

export async function GET(req: NextRequest) {
  const id = accountId(req);
  if (!id) return NextResponse.json({ account: null });
  const acct = await getAccountById(id);
  return NextResponse.json({ account: acct ? view(acct) : null });
}

export async function POST(req: NextRequest) {
  const id = accountId(req);
  if (!id) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  let handles: Record<string, string> | undefined;
  if (body?.handles && typeof body.handles === "object") {
    handles = {};
    for (const p of PLATFORMS) {
      const h = normalizeHandle(body.handles[p]);
      if (h) handles[p] = h;
    }
  }
  const payoutWallet = body?.payoutWallet !== undefined ? cleanWallet(body.payoutWallet) : undefined;
  const payoutChain = typeof body?.payoutChain === "string" ? body.payoutChain.trim().slice(0, 24) : undefined;

  const acct = await updateAccountProfile(id, { payoutWallet, payoutChain, handles });
  if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });
  // Keep the live tenant page in sync with the new handles.
  if (acct.status === "active") await provisionTenant(acct);
  return NextResponse.json({ account: view(acct) });
}
