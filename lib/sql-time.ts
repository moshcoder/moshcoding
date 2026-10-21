/**
 * A UTC timestamp in SQLite's `datetime()` text form ("YYYY-MM-DD HH:MM:SS").
 *
 * Computed here rather than in SQL: on Postgres (through libsql-pg) the
 * translated `datetime('now')` is a timestamptz, and mixing it with a TEXT
 * column fails ("operator does not exist: text > timestamp with time zone",
 * "COALESCE types text and timestamp with time zone cannot be matched").
 * Text in the same fixed-width form compares correctly on both engines and
 * matches the values already stored.
 */
export function sqlTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
