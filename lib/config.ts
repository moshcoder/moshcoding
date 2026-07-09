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

function socialLinks(dn: string, override: any = {}): TenantLink[] {
  if (Array.isArray(override.links)) {
    return override.links.filter((l: any) => l && l.url && l.label);
  }
  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  const s = { website: `https://${dn}`, x: slug, instagram: slug, tiktok: slug, ...(override.socials || {}) };
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

export function configFor(dn: string): TenantConfig {
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
  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  return {
    ...base,
    ...override,
    dn,
    hashtag: override.hashtag || `#${slug}`,
    links: socialLinks(dn, override),
  };
}
