import { normalizeHandle, normalizeUrl, coerceRgba, parseHashtags } from "@/lib/config";
import { normalizeRepo } from "@/lib/github";

export const PLATFORMS = ["x", "bluesky", "instagram", "tiktok", "github", "youtube"];
export const TEXT_FIELDS = ["brand", "headline", "tagline", "sub"] as const;

/** Sanitizes an array of {label,url} link entries. */
function cleanLinks(arr: unknown): { label: string; url: string }[] {
  if (!Array.isArray(arr)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of arr.slice(0, 30)) {
    const url = normalizeUrl((item as any)?.url);
    if (!url) continue;
    let label = String((item as any)?.label || "").trim().slice(0, 60);
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ""); } catch { label = url; } }
    out.push({ label, url });
  }
  return out;
}

/** Sanitizes the content-blocks array: bounded count + size, markdown only. */
function cleanBlocks(arr: unknown): { id: string; type: string; content: string; enabled: boolean }[] {
  if (!Array.isArray(arr)) return [];
  const out: { id: string; type: string; content: string; enabled: boolean }[] = [];
  for (const b of arr.slice(0, 50)) {
    const content = typeof (b as any)?.content === "string" ? (b as any).content.slice(0, 10000) : "";
    if (!content.trim()) continue;
    const rawId = String((b as any)?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    out.push({ id: rawId || `b_${out.length}_${content.length}`, type: "markdown", content, enabled: (b as any)?.enabled !== false });
  }
  return out;
}

/** Builds the sanitized tenant config blob from a request body. Used per-domain. */
export function sanitizeTenantConfig(body: any): Record<string, any> {
  const c: Record<string, any> = {};
  const socials: Record<string, string> = {};
  for (const p of PLATFORMS) {
    const h = normalizeHandle(body?.socials?.[p]);
    if (h) socials[p] = h;
  }
  if (Object.keys(socials).length) c.socials = socials;

  const links = cleanLinks(body?.customLinks ?? body?.links);
  if (links.length) c.customLinks = links;
  const sponsors = cleanLinks(body?.sponsors);
  if (sponsors.length) c.sponsors = sponsors;

  const tags = parseHashtags(Array.isArray(body?.hashtags) ? body.hashtags.join(",") : body?.hashtags);
  if (tags.length) c.hashtags = tags;

  const stream = normalizeUrl(body?.stream);
  if (stream) c.stream = stream;
  const audioStream = normalizeUrl(body?.audioStream ?? body?.audio);
  if (audioStream) c.audioStream = audioStream;
  const videoStream = normalizeUrl(body?.videoStream ?? body?.video);
  if (videoStream) c.videoStream = videoStream;

  const fg = coerceRgba(body?.fgRgba ?? body?.fg_rgba);
  if (fg) c.fgRgba = fg;
  const bg = coerceRgba(body?.bgRgba ?? body?.bg_rgba);
  if (bg) c.bgRgba = bg;

  for (const k of TEXT_FIELDS) {
    if (typeof body?.[k] === "string" && body[k].trim()) c[k] = body[k].trim().slice(0, 120);
  }

  const repo = normalizeRepo(body?.repo);
  if (repo) c.repo = repo;
  if (typeof body?.assetPattern === "string" && body.assetPattern.trim()) c.assetPattern = body.assetPattern.trim().slice(0, 120);

  const blocks = cleanBlocks(body?.blocks);
  if (blocks.length) c.blocks = blocks;
  return c;
}
