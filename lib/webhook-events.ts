const EVENT_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;

export function normalizeInboundEventType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const eventType = value.trim();
  if (!eventType || !EVENT_TYPE_RE.test(eventType)) return null;
  return eventType;
}
