/** Normalize timestamps written by SQLite's datetime() as UTC ISO strings. */
export function normalizeApiKeyTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}

export function formatApiKeyTime(value: string | null): string {
  if (!value) return "never";
  const date = new Date(normalizeApiKeyTimestamp(value));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
