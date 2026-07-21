const MONEY_RE = /^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

export function dollarsToCents(value: unknown): number | null {
  if (value === "" || value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Reject sub-cent precision, exactly as the string path does via MONEY_RE's
    // `\.\d{1,2}`. Without this a bare number like 1.234 silently rounds to 123,
    // letting a partial dollar amount slip through the number path while the
    // equivalent "$1.234" string is rejected.
    const cents = value * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) return null;
    return Math.round(cents);
  }

  const text = String(value).trim().replace(/\s+/g, "");
  if (!MONEY_RE.test(text)) return null;

  const amount = Number(text.replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}
