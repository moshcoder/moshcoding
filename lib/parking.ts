import { safeDomain } from "./config";

export type ParkingParams = Record<string, string | undefined>;

/** The Pit that owns the Moshpit namespace — the registry, not this app. */
export const PIT_BASE_URL = (process.env.PIT_BASE_URL || "https://pit.moshcode.sh").replace(
  /\/+$/,
  "",
);

/**
 * Where /parking?name=<name> belongs.
 *
 * A Moshpit name that hasn't been pointed anywhere is a name in *our* network,
 * so it gets the Pit's own page for it — `/n/<name>`, where you can see who
 * holds it and take it if nobody does. Rendering this app's generic
 * parked-domain card instead was a dead end: it said "IS COMING" about a name
 * that is one click from being yours, and it is not the network we are selling.
 *
 * Porkbun's param forwarding can glue the visitor's query onto the value
 * ("scrambled.eggs?ref=abc"); safeDomain() strips that back to a bare name,
 * which is also what keeps this from being an open redirect — the host is
 * fixed here and only a validated name is ever appended.
 */
export function parkingTarget(sp: ParkingParams): string {
  const name = safeDomain(sp.name ?? sp.dn);
  // Nothing usable to look up — the Pit's front door beats a 404 for someone
  // who just typed a name at us.
  if (!name) return `${PIT_BASE_URL}/pit`;
  return pitNameUrl(name);
}

/** The Pit's page for a name. Callers pass something safeDomain() has cleared. */
export function pitNameUrl(name: string): string {
  return `${PIT_BASE_URL}/n/${encodeURIComponent(name)}`;
}

/**
 * The whole `/parking?name=<name>` decision, kept out of the route so it can be
 * tested without a request.
 *
 * `ours` is `isMoshpitName()`'s answer, passed in rather than imported: that
 * module reads PIT_BASE_URL from this one, and asking for it here would close
 * the cycle.
 *
 *   no usable name  → the Pit's front door, which beats a 404
 *   a Moshpit name  → the Pit's page for it
 *   anything else   → this app's own parked card, via the one `?dn=` path
 *
 * That last branch is the fix for what this route did to every clearnet domain:
 * `moshscript.com`, a domain we own that resolves and has a full tenant page,
 * was permanently redirected to a Pit page reading "Nobody holds this name".
 *
 * Every other param rides along to the tenant page. Porkbun glues `?ref=` onto
 * this URL, and the tenant params (`?style=`, `?social_x=`, …) arrive here too.
 */
export function parkingRoute(sp: ParkingParams, ours: boolean): string {
  const name = safeDomain(sp.name ?? sp.dn);
  if (!name) return `${PIT_BASE_URL}/pit`;
  if (ours) return pitNameUrl(name);

  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string" && key !== "name" && key !== "dn") forwarded.set(key, value);
  }
  forwarded.set("dn", name);
  return `/?${forwarded.toString()}`;
}
