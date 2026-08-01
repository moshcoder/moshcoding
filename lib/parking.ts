export type ParkingParams = Record<string, string | undefined>;

/**
 * Registrar parking/forwarding links point at /parking?name=<domain>, while the
 * tenant renderer at / keys off ?dn=. Map name → dn so both URLs drive one
 * implementation instead of two that drift.
 *
 * Porkbun's param forwarding can glue the visitor's query onto the value
 * ("scrambled.eggs?ref=abc"), and safeDomain() strips that back to a bare
 * domain — so lift any glued ?ref= into its own param before it's lost. An
 * explicit ?ref= already on the URL wins, matching the first-touch rule.
 */
export function toTenantParams(sp: ParkingParams): ParkingParams {
  const { name, ...rest } = sp;
  const raw = typeof name === "string" && name.trim() ? name : rest.dn;
  if (typeof raw !== "string" || !raw.trim()) return rest;

  const out: ParkingParams = { ...rest, dn: raw };
  if (!out.ref) {
    const glued = raw.match(/[?&]ref=([A-Za-z0-9_-]+)/)?.[1];
    if (glued) out.ref = glued;
  }
  return out;
}
