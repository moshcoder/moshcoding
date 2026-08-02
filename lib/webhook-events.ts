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
 * Canonical event subscriptions for one outbound project webhook.
 *
 * Blank lists mean "all events" so the creation form can leave the field
 * empty. Specific names use the same compact grammar as inbound event types;
 * duplicates are removed without changing the order shown back to the user.
 * A wildcard makes specific entries redundant, but every entry is still
 * validated before the list is collapsed to `["*"]`.
 */
export function normalizeWebhookEventSubscriptions(value: unknown): string[] | null {
  if (value === undefined || value === null) return ["*"];
  if (!Array.isArray(value)) return null;

  const events: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const eventType = item.trim();
    if (!eventType) continue;
    if (eventType !== "*" && !EVENT_TYPE_RE.test(eventType)) return null;
    if (!seen.has(eventType)) {
      seen.add(eventType);
      events.push(eventType);
    }
  }

  if (!events.length || seen.has("*")) return ["*"];
  return events;
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
