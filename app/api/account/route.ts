import { NextRequest, NextResponse } from "next/server";
import { getAccountById, updateAccountProfile, updateAccountConfig, setAccountDomain, listParkedDomains } from "@/lib/db";
import { resolveAccountId } from "@/lib/api";
import { normalizeHandle, normalizeUrl, coerceRgba, parseHashtags, safeDomain } from "@/lib/config";
import { payUrl } from "@/lib/coinpay";
import { provisionTenant } from "@/lib/provision";
import { listRepoAssets, normalizeRepo } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS = ["x", "bluesky", "instagram", "tiktok", "github", "youtube"];
const TEXT_FIELDS = ["brand", "headline", "tagline", "sub"] as const;

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
  const audioStream = normalizeUrl(body?.audioStream ?? body?.audio);
  if (audioStream) c.audioStream = audioStream;
  const videoStream = normalizeUrl(body?.videoStream ?? body?.video);
  if (videoStream) c.videoStream = videoStream;

  const fg = coerceRgba(body?.fgRgba ?? body?.fg_rgba);
  if (fg) c.fgRgba = fg;
  const bg = coerceRgba(body?.bgRgba ?? body?.bg_rgba);
  if (bg) c.bgRgba = bg;

  for (const k of TEXT_FIELDS) {
    if (typeof body?.[k] === "string" && body[k].trim()) c[k] = body[k].trim().slice(0, 120);
  }

  // Connected GitHub repo + asset glob (resolved to image URLs in POST).
  const repo = normalizeRepo(body?.repo);
  if (repo) c.repo = repo;
  if (typeof body?.assetPattern === "string" && body.assetPattern.trim()) c.assetPattern = body.assetPattern.trim().slice(0, 120);

  // Content blocks (markdown). Raw markdown is stored; it's rendered safely
  // (escape-first) at display time, so no HTML sanitization is needed here.
  const blocks = cleanBlocks(body?.blocks);
  if (blocks.length) c.blocks = blocks;

  // Uploaded videos ({name, url, poster?}) — pass through so a config save
  // doesn't wipe uploads (they're written to the tenant config by /api/upload).
  const videos = cleanVideos(body?.videos);
  if (videos.length) c.videos = videos;
  return c;
}

/** Keeps uploaded-video entries: same-origin /api/media/ url + optional poster. */
function cleanVideos(arr: unknown): { name: string; url: string; poster?: string }[] {
  if (!Array.isArray(arr)) return [];
  const okUrl = (u: string) => /^\/api\/media\/[A-Za-z0-9._\-/]+$/.test(u) || normalizeUrl(u) === u;
  const out: { name: string; url: string; poster?: string }[] = [];
  for (const v of arr.slice(0, 24)) {
    const url = String((v as any)?.url || "").trim();
    if (!okUrl(url)) continue;
    const entry: { name: string; url: string; poster?: string } = { name: String((v as any)?.name || "video").slice(0, 120), url };
    const poster = String((v as any)?.poster || "").trim();
    if (poster && okUrl(poster)) entry.poster = poster;
    out.push(entry);
  }
  return out;
}

/** Sanitizes the content-blocks array: bounded count + size, known types only. */
function cleanBlocks(arr: unknown): { id: string; type: string; content: string; enabled: boolean }[] {
  if (!Array.isArray(arr)) return [];
  const out: { id: string; type: string; content: string; enabled: boolean }[] = [];
  for (const b of arr.slice(0, 50)) {
    const content = typeof (b as any)?.content === "string" ? (b as any).content.slice(0, 10000) : "";
    if (!content.trim()) continue;
    const rawId = String((b as any)?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    out.push({
      id: rawId || `b_${out.length}_${content.length}`,
      type: "markdown",
      content,
      enabled: (b as any)?.enabled !== false,
    });
  }
  return out;
}

function view(acct: any) {
  return {
    email: acct.email,
    domain: acct.domain,
    payout_wallet: acct.payout_wallet,
    payout_chain: acct.payout_chain,
    plan: acct.plan,
    status: acct.status,
    is_admin: acct.is_admin,
    config: acct.config || {},
    pageUrl: acct.domain ? `/?dn=${encodeURIComponent(acct.domain)}` : null,
    payUrl: acct.status === "pending" && acct.coinpay_payment_id ? payUrl(acct.coinpay_payment_id) : null,
  };
}

export async function GET(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return NextResponse.json({ account: null, parkedDomains: [] });
  const acct = await getAccountById(id);
  return NextResponse.json({ account: acct ? view(acct) : null, parkedDomains: await listParkedDomains(id) });
}

export async function POST(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Claim/change the domain (e.g. a CoinPay user setting up their page).
  if (typeof body?.domain === "string" && body.domain.trim()) {
    const dn = safeDomain(body.domain);
    if (!dn) return NextResponse.json({ error: "Enter a valid domain name." }, { status: 400 });
    await setAccountDomain(id, dn);
  }

  // Payout wallet is edited on its own; only touch it when provided.
  if (body?.payoutWallet !== undefined || body?.payoutChain !== undefined) {
    const payoutWallet = body?.payoutWallet !== undefined ? cleanWallet(body.payoutWallet) : undefined;
    const payoutChain = typeof body?.payoutChain === "string" ? body.payoutChain.trim().slice(0, 24) : undefined;
    await updateAccountProfile(id, { payoutWallet, payoutChain });
  }

  // Full tenant config CRUD — replace the blob when `config` (or any config
  // field) is present, then re-provision the live page.
  let acct = await getAccountById(id);
  let warning: string | undefined;
  const src = body?.config ? body.config : body;
  if (body?.config || src?.socials || src?.customLinks || src?.sponsors || src?.hashtags ||
      src?.stream !== undefined || src?.fgRgba !== undefined || src?.bgRgba !== undefined ||
      src?.repo !== undefined || src?.blocks !== undefined || TEXT_FIELDS.some((k) => src?.[k] !== undefined)) {
    const config = sanitizeConfig(src);
    // Pull image assets from the connected repo (best-effort; don't wipe the
    // existing gallery on a transient GitHub error).
    if (config.repo) {
      try {
        config.assets = await listRepoAssets(config.repo, { pattern: config.assetPattern });
      } catch (e: any) {
        warning = `Couldn't load assets from ${config.repo}: ${e?.message || e}`;
        const prior = (acct?.config as any)?.assets;
        if (Array.isArray(prior)) config.assets = prior;
      }
    }
    acct = await updateAccountConfig(id, config);
  }
  if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (acct.status === "active") await provisionTenant(acct);
  return NextResponse.json({ account: view(acct), parkedDomains: await listParkedDomains(id), ...(warning ? { warning } : {}) });
}
