import { configFor, safeDomain } from "@/lib/config";
import Landing from "@/components/Landing";
import Tenant from "@/components/Tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ dn?: string }>;
}) {
  const sp = await searchParams;
  const dn = safeDomain(sp?.dn);
  if (dn) return <Tenant cfg={configFor(dn)} />;
  return <Landing />;
}
