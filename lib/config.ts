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
  /** Affiliate/sponsor links (?aff_link1=…), rendered under a "Sponsors" heading. */
  sponsors: TenantLink[];
  /** Bare hashtag keywords (rendered as #<kw>). Defaults to the domain slug. */
  hashtags: string[];
  /** Image assets pulled from a connected GitHub repo, rendered as a gallery. */
  assets: TenantLink[];
  /** Uploaded MP4 videos ({name, url}), rendered in the #videos section. */
  videos: { name: string; url: string }[];
  /** Genres from ?style=metal,punk — drives the AI hero-image generation. */
  styles: string[];
  /** Optional background accent (rgba) from ?bg_rgba=; null = use the theme default. */
  bgAccent: string | null;
  /** Optional ?stream= playlist/stream URL — legacy; folded into audioStream. */
  stream: string | null;
  /** ?audio= audio stream/playlist (Spotify, Apple Music, SoundCloud…) → 🎧 Listen. */
  audioStream: string | null;
  /** ?video= live/video stream (Twitch, YouTube, Kick…) → 📺 Watch. */
  videoStream: string | null;
  /** Optional ?code_block= snippet rendered in a monospace block (React-escaped). */
  codeBlock: string | null;
  /** CrawlProof ad slot (UUID). Defaults on for every tenant; null = disabled. */
  adSlot: string | null;
  /** CrawlProof ad format token, e.g. "banner_300x250". */
  adFormat: string;
  /** Owner-authored markdown content blocks, rendered (safely) on the page. */
  blocks: ContentBlock[];
};

export type ContentBlock = { id: string; type: string; content: string; enabled: boolean };

/** Reads/validates saved content blocks (only enabled ones with content). */
export function cleanBlocks(v: unknown): ContentBlock[] {
  if (!Array.isArray(v)) return [];
  const out: ContentBlock[] = [];
  for (const b of v.slice(0, 50)) {
    const content = typeof (b as any)?.content === "string" ? (b as any).content : "";
    if (!content.trim() || (b as any)?.enabled === false) continue;
    out.push({ id: String((b as any)?.id || out.length), type: "markdown", content, enabled: true });
  }
  return out;
}

/** Default moshcoding accent (poison lime). Used unless an rgba override is given. */
export const DEFAULT_ACCENT = "#9EF01A";

/**
 * CrawlProof ad defaults — every parked domain shows this above the footer
 * unless overridden with ?ad_block= (a data-cp-ad snippet, or "slot|format"),
 * or disabled with ?ad_block=none.
 */
export const DEFAULT_AD_SLOT = "fd4ff2e8-db11-438f-8151-3054aa5e1e4c";
export const DEFAULT_AD_FORMAT = "banner_300x250";
const AD_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Resolve an ?ad_block= (or saved) override into a validated {slot,format}.
 *   undefined → not provided (caller falls back to the default ad)
 *   null      → explicitly disabled (none/off/false/0/empty)
 *   {slot,format} → a custom CrawlProof unit
 * We never render the raw HTML — only the extracted UUID slot + format token —
 * so a hostile ?ad_block= value can't inject markup/script.
 */
export function parseAdBlock(v: unknown): { slot: string; format: string } | null | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  if (/^(none|off|false|0|no)$/i.test(t)) return null;
  // Accept a raw <div data-cp-ad …> snippet, a bare UUID, or "slot|format".
  const slotM = t.match(/data-slot=["']?([0-9a-f-]{36})/i) || t.match(AD_UUID_RE);
  const slot = slotM ? (slotM[1] || slotM[0]) : null;
  if (!slot || !AD_UUID_RE.test(slot)) return undefined; // no valid slot → use default
  const fmtM = t.match(/data-format=["']?([a-z0-9_]+)/i) || t.match(/\|\s*([a-z0-9_]+)\s*$/i);
  const format = fmtM ? fmtM[1].slice(0, 40) : DEFAULT_AD_FORMAT;
  return { slot: slot.toLowerCase(), format };
}

/** A ?code_block= snippet: bounded plain text (rendered escaped in a <pre>). */
export function cleanCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Keep printable text + tabs/newlines; drop other control chars. React escapes
  // the rest, so this is only about size + stray control bytes.
  const s = v.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "").slice(0, 2000);
  return s.trim() ? s : null;
}

/** Accepts only an rgb()/rgba() color string; returns it trimmed, or null. */
export function validRgba(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(s) ? s : null;
}

/**
 * Lenient accent parser for ?fg_rgba=/?bg_rgba=. Accepts a full rgb()/rgba()
 * string OR bare comma numbers (e.g. "255,255,255,.66") which get wrapped as
 * rgba(). Whitespace tolerant. Returns a valid color string, or null.
 */
export function coerceRgba(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const direct = validRgba(s);
  if (direct) return direct;
  const m = s.replace(/\s+/g, "").match(/^(\d{1,3}),(\d{1,3}),(\d{1,3})(?:,(0|1|0?\.\d+))?$/);
  if (m) return validRgba(`rgba(${m[1]},${m[2]},${m[3]},${m[4] ?? "1"})`);
  return null;
}

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

/**
 * Normalizes a social handle. Rather than rejecting a messy value, it cleans it:
 * a pasted profile URL collapses to its last path segment, a leading @ is
 * dropped, and any character a handle can't contain (spaces, punctuation, …) is
 * removed — keeping only letters, digits, dot, underscore and hyphen. Returns
 * null only when nothing usable remains, so tenants can hand us a slightly-off
 * handle instead of having to provide a perfectly clean one.
 */
function handle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let h = v.trim();
  if (!h) return null;
  // Someone pasted a full profile URL — keep just the last path segment.
  if (h.includes("/")) h = h.replace(/\/+$/, "").split("/").pop() || "";
  h = h.replace(/^@+/, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  return h || null;
}

/** Public wrapper around the internal handle normalizer (used by signup). */
export function normalizeHandle(v: unknown): string | null {
  return handle(v);
}

/** Public wrapper around the internal URL normalizer (bare domains get https://). */
export function normalizeUrl(v: unknown): string | null {
  return fallbackUrl(v);
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
  // If the tenant named any socials explicitly, show ONLY those (+ website).
  // Otherwise auto-derive the common handles from the domain slug.
  const hasExplicit = override.socials && Object.keys(override.socials).length > 0;
  const defaults = hasExplicit ? {} : { x: slug, instagram: slug, tiktok: slug };
  const s: any = { website, ...defaults, ...(override.socials || {}) };
  const links: TenantLink[] = [];
  if (s.website) links.push({ label: dn, url: s.website, kind: "web" });
  if (s.x) links.push({ label: `@${s.x}`, url: `https://x.com/${s.x}`, kind: "x" });
  if (s.bluesky) links.push({ label: `@${s.bluesky}`, url: `https://bsky.app/profile/${s.bluesky}`, kind: "bluesky" });
  if (s.instagram) links.push({ label: `@${s.instagram}`, url: `https://instagram.com/${s.instagram}`, kind: "instagram" });
  if (s.tiktok) links.push({ label: `@${s.tiktok}`, url: `https://tiktok.com/@${s.tiktok}`, kind: "tiktok" });
  if (s.github) links.push({ label: s.github, url: `https://github.com/${s.github}`, kind: "github" });
  if (s.youtube) links.push({ label: s.youtube, url: `https://youtube.com/@${s.youtube}`, kind: "youtube" });
  if (s.spotify) links.push({ label: "Spotify", url: s.spotify, kind: "spotify" });
  if (s.discord) links.push({ label: "Discord", url: s.discord, kind: "discord" });
  return links;
}

// Query-param platform aliases → canonical social key.
const PLATFORM_ALIAS: Record<string, string> = {
  x: "x", twitter: "x",
  bluesky: "bluesky", blusky: "bluesky", bsky: "bluesky",
  instagram: "instagram", ig: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  github: "github", gh: "github",
  youtube: "youtube", yt: "youtube",
  spotify: "spotify", discord: "discord",
  web: "website", website: "website",
};
// These take a full URL rather than a bare @handle.
const URL_PLATFORMS = new Set(["website", "spotify", "discord"]);

const KNOWN_GENRES = [
  "metal", "punk", "hardcore", "deathcore", "metalcore", "grunge", "thrash",
  "doom", "black-metal", "nu-metal", "emo", "screamo", "industrial", "goth",
];
export function parseStyles(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v.split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter((s) => /^[a-z-]{2,20}$/.test(s)).slice(0, 4);
}

/**
 * Parses ?hashtags=metal,coding,pit — bare keywords (any leading # or non-word
 * chars stripped); the UI renders each as #<keyword>. Deduped, max 8.
 */
export function parseHashtags(v: unknown): string[] {
  if (typeof v !== "string") return [];
  const out: string[] = [];
  for (const raw of v.split(",")) {
    const k = raw.trim().replace(/^#+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 8);
}

/** Per-request overrides threaded from the query string (see app/page.tsx). */
export type TenantOverrides = {
  /** Social handle applied across X / Instagram / TikTok (with or without @). */
  socials?: string | null;
  /** Fallback website/domain to link to while the coming-soon domain is dark. */
  fallback?: string | null;
  /** Per-platform handles/URLs, e.g. { x: "@a", bluesky: "@b.bsky.social" }. Keys may be aliases. */
  social?: Record<string, string | undefined | null>;
  /** Raw ?style= value, e.g. "metal,punk". */
  style?: string | null;
  /** Raw ?link_1=&link_2=… custom-link params (arbitrary links, e.g. our apps). */
  linkParams?: Record<string, string | undefined | null>;
  /** Raw ?aff_link1=&aff_link2=… affiliate/sponsor link params. */
  affParams?: Record<string, string | undefined | null>;
  /** Raw ?hashtags=metal,coding value (bare keywords). */
  hashtags?: string | null;
  /** ?fg_rgba= (or ?rgba=) foreground accent, rgba() only; else default green. */
  fgRgba?: string | null;
  /** ?bg_rgba= background accent, rgba() only. */
  bgRgba?: string | null;
  /** ?stream= playlist/stream URL (Spotify/YouTube/SoundCloud/…). */
  stream?: string | null;
  /** ?audio= audio stream URL. */
  audioStream?: string | null;
  /** ?video= video/live stream URL. */
  videoStream?: string | null;
  /** ?code_block= raw snippet text (rendered escaped in a <pre>). */
  codeBlock?: string | null;
  /** ?ad_block= override: a data-cp-ad snippet / "slot|format" / "none" to disable. */
  adBlock?: string | null;
  /** ?brand= / ?headline= / ?tagline= / ?sub= copy overrides. */
  brand?: string | null;
  headline?: string | null;
  tagline?: string | null;
  sub?: string | null;
  /** Override loaded from the DB tenants table for a provisioned (paid) domain. */
  tenantOverride?: Record<string, any> | null;
};

/**
 * Parses numbered custom-link params. Each value is either a bare/full URL
 * (label derived from the hostname) or "Label|https://url" so a tenant can name
 * the link. Ordered by the numeric suffix; invalid URLs dropped.
 */
function parseNumberedLinks(
  raw: Record<string, string | undefined | null> | undefined,
  re: RegExp,
  kind: string,
): TenantLink[] {
  if (!raw) return [];
  const out: Array<{ n: number; link: TenantLink }> = [];
  for (const [k, v] of Object.entries(raw)) {
    const m = k.match(re);
    if (!m || typeof v !== "string" || !v.trim()) continue;
    let label = "";
    let target = v.trim();
    const bar = target.indexOf("|");
    if (bar > -1) { label = target.slice(0, bar).trim(); target = target.slice(bar + 1).trim(); }
    const url = fallbackUrl(target);
    if (!url) continue;
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ""); } catch { label = url; } }
    out.push({ n: Number(m[1]), link: { label: label.slice(0, 60), url, kind } });
  }
  return out.sort((a, b) => a.n - b.n).map((x) => x.link);
}

/** ?link_1=&link_2=… arbitrary links (e.g. our apps), shown in the main list. */
export function parseLinks(raw: TenantOverrides["linkParams"]): TenantLink[] {
  return parseNumberedLinks(raw, /^link_?(\d+)$/i, "link");
}

/** ?aff_link1=&aff_link2=… affiliate/sponsor links, shown under "Sponsors". */
export function parseSponsors(raw: TenantOverrides["affParams"]): TenantLink[] {
  return parseNumberedLinks(raw, /^aff_?link_?(\d+)$/i, "sponsor");
}

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

  // A provisioned (paid) tenant is stored in the DB — it wins over the on-disk
  // file (which won't persist on Railway), merging socials rather than replacing.
  if (opts.tenantOverride && typeof opts.tenantOverride === "object") {
    const t = opts.tenantOverride;
    override = {
      ...override,
      ...t,
      socials: { ...(override.socials || {}), ...(t.socials || {}) },
    };
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
      // Also use the fallback domain's name as the generic social handle
      // (platforms `socials` didn't set), so one ?fallback= brands links + socials.
      let host = "";
      try { host = new URL(fbUrl).hostname.replace(/^www\./, ""); } catch { host = ""; }
      const fbName = host.split(".")[0].replace(/[^a-z0-9]/g, "");
      if (fbName) {
        override = { ...override, socials: { x: fbName, instagram: fbName, tiktok: fbName, ...(override.socials || {}) } };
      }
    } else {
      const fbh = handle(fbRaw);
      if (fbh) {
        override = { ...override, socials: { x: fbh, instagram: fbh, tiktok: fbh, ...(override.socials || {}) } };
      }
    }
  }

  // Per-platform overrides (?social_x=&social_bluesky=…) — most specific, win last.
  if (opts.social) {
    const per: Record<string, string> = {};
    for (const [rawK, rawV] of Object.entries(opts.social)) {
      const key = PLATFORM_ALIAS[rawK.toLowerCase()];
      if (!key || typeof rawV !== "string" || !rawV.trim()) continue;
      const val = URL_PLATFORMS.has(key)
        ? (key === "website" ? fallbackUrl(rawV) : rawV.trim())
        : handle(rawV);
      if (val) per[key] = val;
    }
    if (Object.keys(per).length) override = { ...override, socials: { ...(override.socials || {}), ...per } };
  }

  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  const ov = override; // includes the merged DB tenant config (see tenantOverride above)
  const cleanLinks = (arr: any, kind: string): TenantLink[] =>
    Array.isArray(arr)
      ? arr.filter((l) => l && l.url && l.label).map((l) => ({ label: String(l.label).slice(0, 60), url: String(l.url), kind }))
      : [];

  // Socials/website first, then ?link_N= query links, then saved custom links.
  const links = [...socialLinks(dn, override), ...parseLinks(opts.linkParams), ...cleanLinks(ov.customLinks, "link")];
  // Sponsors: ?aff_linkN= query + saved sponsors.
  const sponsors = [...parseSponsors(opts.affParams), ...cleanLinks(ov.sponsors, "sponsor")];
  // GitHub repo image assets (saved with {name,url}); rendered as a gallery.
  const assets = Array.isArray(ov.assets)
    ? ov.assets.filter((a: any) => a && a.url).map((a: any) => ({ label: String(a.name || a.label || ""), url: String(a.url), kind: "image" }))
    : [];
  // Uploaded MP4 videos ({name, url}).
  const videos = Array.isArray(ov.videos)
    ? ov.videos.filter((v: any) => v && v.url).map((v: any) => ({ name: String(v.name || "video"), url: String(v.url) })).slice(0, 24)
    : [];
  // Hashtags: ?hashtags= query, else saved config, else the domain slug.
  const parsedTags = parseHashtags(opts.hashtags);
  const savedTags = Array.isArray(ov.hashtags)
    ? ov.hashtags.map((h: any) => String(h).replace(/[^a-z0-9]/gi, "").toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  const hashtags = parsedTags.length ? parsedTags : (savedTags.length ? savedTags : (slug ? [slug] : []));

  // ?brand=&headline=&tagline=&sub= copy overrides win over file/DB/defaults.
  const cleanText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : undefined);
  const queryText: Record<string, string> = {};
  for (const k of ["brand", "headline", "tagline", "sub"] as const) {
    const t = cleanText((opts as any)[k]);
    if (t) queryText[k] = t;
  }

  return {
    ...base,
    ...override,
    ...queryText,
    dn,
    hashtag: override.hashtag || (sh ? `#${sh}` : `#${slug}`),
    links,
    sponsors,
    hashtags,
    assets,
    videos,
    styles: parseStyles(opts.style),
    // query wins, then saved config, then the default moshcoding green.
    accent: coerceRgba(opts.fgRgba) || coerceRgba(ov.fgRgba) || DEFAULT_ACCENT,
    bgAccent: coerceRgba(opts.bgRgba) || coerceRgba(ov.bgRgba),
    stream: fallbackUrl(opts.stream) || fallbackUrl(ov.stream),
    // Audio falls back to the legacy single `stream` so existing tenants keep working.
    audioStream:
      fallbackUrl(opts.audioStream) || fallbackUrl(ov.audioStream) ||
      fallbackUrl(opts.stream) || fallbackUrl(ov.stream),
    videoStream: fallbackUrl(opts.videoStream) || fallbackUrl(ov.videoStream),
    codeBlock: cleanCode(opts.codeBlock) || cleanCode(ov.codeBlock),
    // Ad: ?ad_block= query wins, then the saved tenant value, else the default
    // CrawlProof unit. `null` from either (e.g. ad_block=none) disables it.
    ...(() => {
      const q = parseAdBlock(opts.adBlock);
      const saved = parseAdBlock(ov.adBlock);
      const ad = q !== undefined ? q : saved !== undefined ? saved : { slot: DEFAULT_AD_SLOT, format: DEFAULT_AD_FORMAT };
      return { adSlot: ad ? ad.slot : null, adFormat: ad ? ad.format : DEFAULT_AD_FORMAT };
    })(),
    // Owner-authored markdown blocks come only from the saved tenant config.
    blocks: cleanBlocks(ov.blocks),
  };
}
