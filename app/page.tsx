import type { Metadata } from "next";
import { configFor, safeDomain } from "@/lib/config";
import { getTenantConfig } from "@/lib/db";
import Landing from "@/components/Landing";
import Tenant from "@/components/Tenant";
import BidPage from "@/components/BidPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-tenant OpenGraph/Twitter with a branded, generated og:image so every
// parked domain shares nicely. No ?dn= → the landing keeps the layout defaults.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const sp = (await searchParams) || {};
  const dn = safeDomain(sp.dn);
  if (!dn) return {};
  const tenantOverride = await getTenantConfig(dn).catch(() => null);
  const cfg = configFor(dn, {
    tenantOverride, brand: sp.brand, headline: sp.headline, tagline: sp.tagline,
    sub: sp.sub, socials: sp.socials, fallback: sp.fallback,
  });
  const q = new URLSearchParams({ dn, brand: cfg.brand, headline: cfg.headline, tagline: cfg.tagline });
  const og = `/api/og?${q.toString()}`;
  const title = `${cfg.brand} ${cfg.headline}`.trim();
  return {
    title,
    description: cfg.tagline,
    openGraph: { title, description: cfg.tagline, url: `https://${dn}`, images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description: cfg.tagline, images: [og] },
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
  const dn = safeDomain(sp.dn);
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
        hashtags: sp.hashtags, fgRgba: sp.fg_rgba ?? sp.rgba, bgRgba: sp.bg_rgba, stream: sp.stream,
        brand: sp.brand, headline: sp.headline, tagline: sp.tagline, sub: sp.sub,
        codeBlock: sp.code_block, adBlock: sp.ad_block, tenantOverride,
      })}
    />
  );
}
