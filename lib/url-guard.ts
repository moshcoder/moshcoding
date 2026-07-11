/* ---- SSRF guard: never POST to internal/loopback/link-local addresses ---- */
export function isInternalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return true;
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") return true;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "metadata.google.internal") return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  const ipv6 = h.replace(/^\[|\]$/g, "");
  if (ipv6.includes(":")) {
    const mapped = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16);
      const low = Number.parseInt(mapped[2]!, 16);
      const a = high >> 8;
      const b = high & 255;
      const c = low >> 8;
      if (
        a === 127 ||
        a === 10 ||
        a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      ) return true;
      if (a || b || c || low) return false;
    }
    if (
      ipv6 === "::" ||
      ipv6 === "::1" ||
      ipv6.startsWith("fe80:") ||
      ipv6.startsWith("fc") ||
      ipv6.startsWith("fd") ||
      ipv6.startsWith("::ffff:10.") ||
      ipv6.startsWith("::ffff:127.") ||
      ipv6.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(ipv6) ||
      ipv6.startsWith("::ffff:169.254.")
    ) return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}
