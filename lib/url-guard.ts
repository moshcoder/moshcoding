/* ---- SSRF guard: never POST to internal/loopback/link-local addresses ---- */
export function isInternalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return true;
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") return true;

  // Reject non-numeric ports; odd ports can hide alternate protocols.
  if (u.port !== "" && !/^\d{1,5}$/.test(u.port)) return true;

  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "metadata.google.internal") return true;
  if (h === "0.0.0.0") return true;

  const ipv6 = h.replace(/^\[|\]$/g, "");
  if (ipv6.includes(":")) {
    if (ipv6 === "::" || ipv6 === "::1") return true;

    // IPv4-mapped, IPv4-compatible, 6to4, NAT64, ISATAP — anything ending in a
    // dotted-decimal IPv4 goes through the same private-range check.
    const embedded = ipv6.match(/([0-9a-f.:]*:|^)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (embedded) {
      if (isPrivateIPv4(embedded[2])) return true;
    }

    // Hex-encoded IPv4-mapped / -compatible forms:
    //   ::ffff:HHHH:HHHH  (127.0.0.1 = ::ffff:7f00:1)
    //   ::HHHH:HHHH       (IPv4-compatible, deprecated but still parsable)
    const mapped = ipv6.match(/^(?:::(?:ffff:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16);
      const low = Number.parseInt(mapped[2]!, 16);
      if (isPrivateIPv4Octets(high >> 8, high & 255, low >> 8, low & 255)) return true;
    }

    if (
      ipv6.startsWith("fe80:") ||       // link-local
      ipv6.startsWith("fc") ||          // unique-local fc00::/7 (fc + fd)
      ipv6.startsWith("fd") ||
      ipv6.startsWith("64:ff9b:") ||    // NAT64 well-known prefix (RFC 6052)
      ipv6.startsWith("100::") ||        // discard / reserved (RFC 6666)
      ipv6.startsWith("2001:db8:") ||   // documentation (RFC 3849)
      ipv6.startsWith("2002:")          // 6to4 (RFC 3056)
    ) return true;

    return false;
  }

  // Dotted-decimal IPv4.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    // Reject malformed octets (>255) — fail closed. Different URL/IP parsers
    // (OS, fetch, legacy resolvers) can reinterpret overflow values as internal.
    if (parts.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
    if (isPrivateIPv4Octets(parts[0], parts[1], parts[2], parts[3])) return true;
  }
  return false;
}

/** True for any IPv4 that must never be reached server-side. */
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return true;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  return isPrivateIPv4Octets(parts[0], parts[1], parts[2], parts[3]);
}

function isPrivateIPv4Octets(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0) return true;                                                           // 0.0.0.0/8 ("this" network)
  if (a === 10) return true;                                                          // RFC1918 10/8
  if (a === 127) return true;                                                         // loopback 127/8
  if (a === 169 && b === 254) return true;                                            // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;                                   // RFC1918 172.16/12
  if (a === 192 && b === 168) return true;                                            // RFC1918 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;                                  // CGNAT/shared (RFC6598)
  if (a === 198 && (b === 18 || b === 19)) return true;                               // interconnect/benchmark (RFC2544)
  if (a === 192 && b === 0 && c === 2) return true;                                   // TEST-NET-1 (RFC5737)
  if (a === 198 && b === 51 && c === 100) return true;                                // TEST-NET-2 (RFC5737)
  if (a === 203 && b === 0 && c === 113) return true;                                 // TEST-NET-3 (RFC5737)
  return false;
}
