import { redirect } from "next/navigation";
import { safeDomain } from "@/lib/config";
import { isMoshpitName } from "@/lib/moshpit-tlds";
import { parkingRoute } from "@/lib/parking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | undefined>;

/**
 * /parking?name=<name> — where a domain lands when it has not been pointed
 * anywhere yet. Porkbun forwarding sends the domain's own name here, so what
 * arrives is either a Moshpit name or an ordinary parked clearnet domain.
 *
 * A Moshpit name goes to the Pit's page for it. A clearnet domain renders its
 * own parked card. Which is which is `isMoshpitName()` — the same question `/`
 * asks of the Host, and the check this route never made: without it the Pit got
 * *every* domain, including ones we own that resolve and have tenant pages.
 *
 * 307, not 308, for the same reason `/` uses one: the owner can point the name
 * at a real target at any moment, and a permanent redirect cached in a browser
 * keeps sending them here long after this app stopped being the answer.
 */
export default async function Parking({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = (await searchParams) || {};
  const name = safeDomain(sp.name ?? sp.dn);
  redirect(parkingRoute(sp, name ? await isMoshpitName(name) : false));
}
