import { configFor, safeDomain } from "@/lib/config";
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
      })}
    />
  );
}
