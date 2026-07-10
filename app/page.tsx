import type { Metadata } from "next";
import { headers } from "next/headers";
import { configFor, safeDomain } from "@/lib/config";
import { getTenantConfig } from "@/lib/db";
import Landing from "@/components/Landing";
import Tenant from "@/components/Tenant";
import BidPage from "@/components/BidPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The parked domain from the Host header, when the app is served DIRECTLY on a
 * branded custom domain (not moshcoding.com / *.railway.app / localhost). Lets a
 * domain pointed straight at this service render its own tenant page natively —
 * no iframe, no CSP, and query params (?ref, ?bid) arrive intact. Returns null
 * for the main app host so moshcoding.com keeps its landing page.
 */
async function hostTenantDn(): Promise<string | null> {
  const h = await headers();
  const host = (h.get("host") || "").toLowerCase().split(":")[0].replace(/^www\./, "");
  if (!host) return null;
  const appHost = (process.env.APP_BASE_URL || "https://moshcoding.com")
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().replace(/^www\./, "");
  if (host === appHost || host === "localhost" || host === "127.0.0.1") return null;
  if (/\.railway\.app$|\.up\.railway\.app$/.test(host)) return null;
  return safeDomain(host);
}

// Per-tenant OpenGraph/Twitter with a branded, generated og:image so every
// parked domain shares nicely. No ?dn= → the landing keeps the layout defaults.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const sp = (await searchParams) || {};
  const dn = safeDomain(sp.dn) || (await hostTenantDn());
  if (!dn) return {};
  const tenantOverride = await getTenantConfig(dn).catch(() => null);
  const cfg = configFor(dn, {
    tenantOverride, brand: sp.brand, headline: sp.headline, tagline: sp.tagline,
    sub: sp.sub, socials: sp.socials, fallback: sp.fallback,
  });
  const q = new URLSearchParams({ dn, brand: cfg.brand, headline: cfg.headline, tagline: cfg.tagline });
  const generatedOg = `/api/og?${q.toString()}`;
  // Prefer a real image discovered from the tenant's connected GitHub repo; fall
  // back to the branded, generated card when the tenant has no repo image.
  const discovered = cfg.assets.find((a) => a.kind === "image" && /^https:\/\//i.test(a.url))?.url;
  const ogImage = discovered ? { url: discovered } : { url: generatedOg, width: 1200, height: 630 };
  const title = `${cfg.brand} ${cfg.headline}`.trim();
  return {
    title,
    description: cfg.tagline,
    openGraph: { title, description: cfg.tagline, url: `https://${dn}`, images: [ogImage] },
    twitter: { card: "summary_large_image", title, description: cfg.tagline, images: [ogImage.url] },
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = (await searchParams) || {};
  const bidDn = safeDomain(sp.bid);
  if (bidDn) return <BidPage dn={bidDn} />;
  // ?dn wins (iframe/masked path); else the branded Host (direct custom domain).
  const dn = safeDomain(sp.dn) || (await hostTenantDn());
  if (!dn) return <Landing />;

  // A paid/provisioned domain has a tenants row that overrides the defaults.
  const tenantOverride = await getTenantConfig(dn).catch(() => null);

  // collect ?social_x=&social_bluesky=… into a per-platform map, and
  // ?link_1=&link_2=… arbitrary custom links (our apps etc.) into another.
  const social: Record<string, string> = {};
  const linkParams: Record<string, string> = {};
  const affParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v !== "string") continue;
    const sm = k.match(/^social_(.+)$/i);
    if (sm) { social[sm[1]] = v; continue; }
    if (/^aff_?link_?\d+$/i.test(k)) { affParams[k] = v; continue; }
    if (/^link_?\d+$/i.test(k)) linkParams[k] = v;
  }

  return (
    <Tenant
      cfg={configFor(dn, {
        socials: sp.socials, fallback: sp.fallback, social, style: sp.style, linkParams, affParams,
        hashtags: sp.hashtags, fgRgba: sp.fg_rgba ?? sp.rgba, bgRgba: sp.bg_rgba,
        stream: sp.stream, audioStream: sp.audio ?? sp.audio_stream, videoStream: sp.video ?? sp.video_stream,
        brand: sp.brand, headline: sp.headline, tagline: sp.tagline, sub: sp.sub,
        codeBlock: sp.code_block, adBlock: sp.ad_block, tenantOverride,
      })}
    />
  );
}
