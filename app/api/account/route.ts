import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { getAccountById, updateAccountProfile, updateAccountConfig } from "@/lib/db";
import { normalizeHandle, normalizeUrl, coerceRgba, parseHashtags } from "@/lib/config";
import { payUrl } from "@/lib/coinpay";
import { provisionTenant } from "@/lib/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS = ["x", "bluesky", "instagram", "tiktok", "github", "youtube"];
const TEXT_FIELDS = ["brand", "headline", "tagline", "sub"] as const;

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

/** Sanitizes an array of {label,url} link entries. */
function cleanLinks(arr: unknown): { label: string; url: string }[] {
  if (!Array.isArray(arr)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of arr.slice(0, 30)) {
    const url = normalizeUrl((item as any)?.url);
    if (!url) continue;
    let label = String((item as any)?.label || "").trim().slice(0, 60);
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ""); } catch { label = url; } }
    out.push({ label, url });
  }
  return out;
}

/** Builds the sanitized tenant config blob from a request body. */
function sanitizeConfig(body: any): Record<string, any> {
  const c: Record<string, any> = {};
  const socials: Record<string, string> = {};
  for (const p of PLATFORMS) {
    const h = normalizeHandle(body?.socials?.[p]);
    if (h) socials[p] = h;
  }
  if (Object.keys(socials).length) c.socials = socials;

  const links = cleanLinks(body?.customLinks ?? body?.links);
  if (links.length) c.customLinks = links;
  const sponsors = cleanLinks(body?.sponsors);
  if (sponsors.length) c.sponsors = sponsors;

  const tags = parseHashtags(Array.isArray(body?.hashtags) ? body.hashtags.join(",") : body?.hashtags);
  if (tags.length) c.hashtags = tags;

  const stream = normalizeUrl(body?.stream);
  if (stream) c.stream = stream;

  const fg = coerceRgba(body?.fgRgba ?? body?.fg_rgba);
  if (fg) c.fgRgba = fg;
  const bg = coerceRgba(body?.bgRgba ?? body?.bg_rgba);
  if (bg) c.bgRgba = bg;

  for (const k of TEXT_FIELDS) {
    if (typeof body?.[k] === "string" && body[k].trim()) c[k] = body[k].trim().slice(0, 120);
  }
  return c;
}

function view(acct: any) {
  return {
    email: acct.email,
    domain: acct.domain,
    payout_wallet: acct.payout_wallet,
    payout_chain: acct.payout_chain,
    plan: acct.plan,
    status: acct.status,
    config: acct.config || {},
    pageUrl: acct.domain ? `/?dn=${encodeURIComponent(acct.domain)}` : null,
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

  // Payout wallet is edited on its own; only touch it when provided.
  if (body?.payoutWallet !== undefined || body?.payoutChain !== undefined) {
    const payoutWallet = body?.payoutWallet !== undefined ? cleanWallet(body.payoutWallet) : undefined;
    const payoutChain = typeof body?.payoutChain === "string" ? body.payoutChain.trim().slice(0, 24) : undefined;
    await updateAccountProfile(id, { payoutWallet, payoutChain });
  }

  // Full tenant config CRUD — replace the blob when `config` (or any config
  // field) is present, then re-provision the live page.
  let acct = await getAccountById(id);
  if (body?.config || body?.socials || body?.customLinks || body?.sponsors || body?.hashtags ||
      body?.stream !== undefined || body?.fgRgba !== undefined || body?.bgRgba !== undefined ||
      TEXT_FIELDS.some((k) => body?.[k] !== undefined)) {
    const config = sanitizeConfig(body?.config ? body.config : body);
    acct = await updateAccountConfig(id, config);
  }
  if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (acct.status === "active") await provisionTenant(acct);
  return NextResponse.json({ account: view(acct) });
}
