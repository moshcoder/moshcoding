import type { Metadata } from "next";
import { toTenantParams } from "@/lib/parking";
import TenantPage, { generateMetadata as tenantMetadata } from "../page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | undefined>;

/**
 * /parking?name=<domain> — the URL registrar parking pages and forwarding rules
 * point at. It renders the tenant page in place rather than redirecting to
 * /?dn=<domain>, so the link a registrar already holds keeps working and masked
 * forwarding never sees a hop. All other params (?ref, ?brand, ?social_*, …)
 * pass straight through to the same renderer as /.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = (await searchParams) || {};
  return tenantMetadata({ searchParams: Promise.resolve(toTenantParams(sp)) });
}

export default async function Parking({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = (await searchParams) || {};
  // No usable name → the tenant renderer falls back to <Landing />, not a 404.
  return TenantPage({ searchParams: Promise.resolve(toTenantParams(sp)) });
}
