import { permanentRedirect } from "next/navigation";
import { parkingTarget } from "@/lib/parking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | undefined>;

/**
 * /parking?name=<name> — where a Moshpit name lands when it has not been
 * pointed anywhere yet.
 *
 * It sends the visitor to the Pit's page for that name rather than rendering a
 * parked-domain card here. A 308 (not a 307) because the name's home really is
 * `/n/<name>` and always will be: crawlers follow it and index the Pit page,
 * instead of holding on to a moshcoding.com URL that only ever bounces.
 */
export default async function Parking({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = (await searchParams) || {};
  permanentRedirect(parkingTarget(sp));
}
