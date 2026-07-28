const EVENT_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;

/** Header carrying how many times an event has already been relayed by us. */
export const RELAY_HOP_HEADER = "x-moshcoding-hop";

/** Relays stop after this many hops, so a mis-pointed target can't loop forever. */
export const MAX_RELAY_HOPS = 3;

export function normalizeInboundEventType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const eventType = value.trim();
  if (!eventType || !EVENT_TYPE_RE.test(eventType)) return null;
  return eventType;
}

/**
 * Event type used when relaying an inbound event to a domain's outbound targets.
 * The `inbound.` prefix is applied at most once: a target pointed back at our own
 * receiver would otherwise re-enter with `inbound.x` and relay `inbound.inbound.x`,
 * growing a prefix chain on every hop.
 */
export function relayEventType(eventType: unknown): string {
  const t = normalizeInboundEventType(eventType) || "event";
  return t.startsWith("inbound.") ? t : `inbound.${t}`;
}

/** Hop count off an incoming relay; anything unparseable counts as a first hop. */
export function parseRelayHop(value: unknown): number {
  const n = Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, MAX_RELAY_HOPS);
}
