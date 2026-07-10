import { configFor, safeDomain } from "@/lib/config";
import { getTenantConfig } from "@/lib/db";
import Landing from "@/components/Landing";
import Tenant from "@/components/Tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = (await searchParams) || {};
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
        brand: sp.brand, headline: sp.headline, tagline: sp.tagline, sub: sp.sub, tenantOverride,
      })}
    />
  );
}
