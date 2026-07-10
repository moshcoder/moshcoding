import fs from "node:fs";
import path from "node:path";

const CONFIG_DIR = path.join(process.cwd(), "configs");

export type TenantLink = { label: string; url: string; kind?: string };
export type TenantConfig = {
  dn: string;
  brand: string;
  headline: string;
  tagline: string;
  sub: string;
  accent: string;
  cta: string;
  hashtag: string;
  links: TenantLink[];
};

export function safeDomain(dn: unknown): string | null {
  if (typeof dn !== "string") return null;
  const d = dn.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]{3,253}$/.test(d) || !d.includes(".") || d.includes("..")) return null;
  return d;
}

function titleize(dn: string): string {
  const base = dn.split(".")[0].replace(/[-_]+/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalizes a social handle: strips a leading @, spaces, and URL noise. */
function handle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const h = v.trim().replace(/^@+/, "").replace(/\s+/g, "");
  return /^[a-zA-Z0-9._-]{1,64}$/.test(h) ? h : null;
}

/** Normalizes a fallback target to an absolute URL (bare domains get https://). */
function fallbackUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  const d = safeDomain(t);
  return d ? `https://${d}` : null;
}

function socialLinks(dn: string, override: any = {}): TenantLink[] {
  if (Array.isArray(override.links)) {
    return override.links.filter((l: any) => l && l.url && l.label);
  }
  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  // The coming-soon domain usually isn't live yet, so the "website" link points
  // at the fallback target when one is supplied.
  const website = override.website || `https://${dn}`;
  const s = { website, x: slug, instagram: slug, tiktok: slug, ...(override.socials || {}) };
  const links: TenantLink[] = [];
  if (s.website) links.push({ label: dn, url: s.website, kind: "web" });
  if (s.x) links.push({ label: `@${s.x}`, url: `https://x.com/${s.x}`, kind: "x" });
  if (s.instagram) links.push({ label: `@${s.instagram}`, url: `https://instagram.com/${s.instagram}`, kind: "instagram" });
  if (s.tiktok) links.push({ label: `@${s.tiktok}`, url: `https://tiktok.com/@${s.tiktok}`, kind: "tiktok" });
  if (s.github) links.push({ label: s.github, url: `https://github.com/${s.github}`, kind: "github" });
  if (s.youtube) links.push({ label: s.youtube, url: `https://youtube.com/@${s.youtube}`, kind: "youtube" });
  if (s.spotify) links.push({ label: "Spotify", url: s.spotify, kind: "spotify" });
  if (s.discord) links.push({ label: "Discord", url: s.discord, kind: "discord" });
  return links;
}

/** Per-request overrides threaded from the query string (see app/page.tsx). */
export type TenantOverrides = {
  /** Social handle applied across X / Instagram / TikTok (with or without @). */
  socials?: string | null;
  /** Fallback website/domain to link to while the coming-soon domain is dark. */
  fallback?: string | null;
};

export function configFor(dn: string, opts: TenantOverrides = {}): TenantConfig {
  const base = {
    dn,
    brand: titleize(dn),
    headline: "IS COMING",
    tagline: "Something heavy is compiling.",
    sub: "Join the pit. Be first in the door when it drops.",
    accent: "#9EF01A",
    cta: "Join the waitlist",
  };
  let override: any = {};
  const file = path.join(CONFIG_DIR, `${dn}.json`);
  if (fs.existsSync(file)) {
    try { override = JSON.parse(fs.readFileSync(file, "utf8")); } catch { override = {}; }
  }

  // Query-string overrides win over the on-disk config file so a single link can
  // brand a coming-soon page without shipping a config: ?dn=&socials=&fallback=.
  const sh = handle(opts.socials);
  if (sh) override = { ...override, socials: { ...(override.socials || {}), x: sh, instagram: sh, tiktok: sh } };

  // `fallback` accepts EITHER a domain/URL or a social handle. A domain/URL
  // overrides the website link (the coming-soon domain is usually still dark);
  // a bare handle fills the social handles for platforms `socials` didn't set
  // (so `socials` wins per-platform when both are given).
  const fbRaw = typeof opts.fallback === "string" ? opts.fallback.trim() : "";
  if (fbRaw) {
    const fbUrl = fallbackUrl(fbRaw);
    if (fbUrl) {
      override = { ...override, website: fbUrl };
    } else {
      const fbh = handle(fbRaw);
      if (fbh) {
        override = { ...override, socials: { x: fbh, instagram: fbh, tiktok: fbh, ...(override.socials || {}) } };
      }
    }
  }

  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  return {
    ...base,
    ...override,
    dn,
    hashtag: override.hashtag || (sh ? `#${sh}` : `#${slug}`),
    links: socialLinks(dn, override),
  };
}
