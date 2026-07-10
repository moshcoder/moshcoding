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

  // collect ?social_x=&social_bluesky=… into a per-platform map
  const social: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const m = k.match(/^social_(.+)$/i);
    if (m && typeof v === "string") social[m[1]] = v;
  }

  return <Tenant cfg={configFor(dn, { socials: sp.socials, fallback: sp.fallback, social, style: sp.style })} />;
}
