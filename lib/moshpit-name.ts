// Validation and policy for Moshpit TLD names.
//
// Deliberately free of any database import so it can be tested — and reused by
// a client — without a Turso connection. lib/moshpit.ts owns the storage.

/**
 * Names nobody may claim, whatever the PRD's first-come-first-served rule says.
 *
 * The moment a namespace sells `.bank` or `.apple` it has a phishing and
 * trademark problem, and neither is cheap to unwind after the fact. A static
 * list is a blunt instrument, but it is the one that works on day one; PRD 0001
 * R9 (reputation / anti-squatting) is the longer answer.
 */
export const RESERVED_TLDS = new Set([
  // trades on trust in money
  "bank", "banking", "paypal", "visa", "mastercard", "amex", "stripe", "coinbase",
  // trades on trust in a company
  "apple", "google", "microsoft", "amazon", "meta", "facebook", "netflix", "openai",
  "anthropic", "github", "x", "twitter", "tesla",
  // trades on trust in an institution
  "gov", "police", "nhs", "irs", "fbi", "army", "navy",
  // ours: the network's own names are not for sale
  "moshpit", "moshcode", "moshcoding", "profullstack", "logicsrc",
  // collide with the legacy internet in ways that would only ever confuse
  "com", "net", "org", "edu", "mil", "int", "arpa", "localhost", "local", "onion", "test", "invalid", "example",
]);

/** A TLD label: lowercase letters, digits and dashes; no leading/trailing dash. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalise user input into a bare TLD label, or null when it could never be
 * one. Accepts ".eggs", "eggs", " .EGGS " — people type the dot.
 */
export function normalizeTld(input: unknown): string | null {
  const raw = String(input ?? "").trim().toLowerCase().replace(/^\.+/, "");
  if (!raw || raw.length > 63) return null;
  // A dot means they gave a domain, not a TLD. Say so rather than silently
  // registering the wrong thing.
  if (raw.includes(".")) return null;
  if (!LABEL.test(raw)) return null;
  // All-numeric would be ambiguous against an IPv4 literal in a hostname.
  if (/^\d+$/.test(raw)) return null;
  return raw;
}

/** Why a TLD cannot be registered, or null when it is fine. */
export function tldRejection(tld: string): string | null {
  if (RESERVED_TLDS.has(tld)) return "that name is reserved";
  if (tld.length < 2) return "a TLD needs at least 2 characters";
  return null;
}
