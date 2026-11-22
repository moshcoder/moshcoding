// Per-host sitemap.xml and robots.txt. This one app answers on moshcoding.com
// and on every parked domain pointed at it (moshcoders.com, moshscript.com,
// ...), each rendering its own page, so both files are built from the request
// host: a parked domain lists only its own home page, the app host lists its
// public pages. Never a URL on another host.

const APP_PATHS = ["/", "/pit", "/videos", "/badges", "/signup", "/login"];

/** The bare request host (lowercase, no port, no www.), or null if unusable. */
export function sitemapHost(raw: string | null | undefined): string | null {
  const host = (raw || "").split(",")[0].trim().toLowerCase().split(":")[0].replace(/^www\./, "");
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || !host.includes(".") || host.includes("..")) return null;
  if (host.startsWith(".") || host.endsWith(".")) return null;
  return host;
}

export function appHost(): string {
  return (process.env.APP_BASE_URL || "https://moshcoding.com")
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().replace(/^www\./, "");
}

/** Public paths for a host: the app's pages on the app host, "/" on a parked domain. */
export function sitemapPaths(host: string, app = appHost()): string[] {
  return host === app ? APP_PATHS : ["/"];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemapXml(host: string, app = appHost()): string {
  const urls = sitemapPaths(host, app)
    .map((p) => `  <url><loc>${esc(`https://${host}${p}`)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt(host: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /dashboard",
    "",
    `Sitemap: https://${host}/sitemap.xml`,
    "",
  ].join("\n");
}

/** The host to describe: X-Forwarded-Host, then Host, then the app host. */
export function hostFromHeaders(h: Headers): string {
  return sitemapHost(h.get("x-forwarded-host")) || sitemapHost(h.get("host")) || appHost();
}
