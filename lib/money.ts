const MONEY_RE = /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

export function dollarsToCents(value: unknown): number | null {
  if (value === "" || value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }

  const text = String(value).trim().replace(/\s+/g, "");
  if (!MONEY_RE.test(text)) return null;

  const amount = Number(text.replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}
