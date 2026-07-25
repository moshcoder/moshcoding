const COMMISSION_RE = /^(?:\d+)(?:\.\d{1,2})?$/;

export function parseCommissionPercent(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!COMMISSION_RE.test(text)) return null;
  const pct = Number(text);
  return Number.isFinite(pct) ? pct : null;
}
