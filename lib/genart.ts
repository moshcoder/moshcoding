// AI hero-image generation for tenant pages (?style=metal,punk…). Images are
// generated once on first request and cached on the filesystem (DATA_DIR).

import fs from "node:fs";
import path from "node:path";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const CACHE_DIR = path.join(DATA_DIR, "generated");

export function imagesEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Stable cache key from domain + sorted genres. */
export function imageKey(dn: string, styles: string[]): string {
  const g = [...styles].sort().join("-") || "default";
  return `${dn}__${g}`.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120);
}

export function cachedPath(key: string): string {
  return path.join(CACHE_DIR, `${key}.png`);
}

export function readCached(key: string): Buffer | null {
  const p = cachedPath(key);
  try {
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  } catch {
    return null;
  }
}

function buildPrompt(brand: string, styles: string[]): string {
  const genres = styles.length ? styles.join(" / ") : "metal";
  // Brand palette is constant (poison lime green on near-black) regardless of genre.
  return [
    `Square album-cover / gig-poster artwork for a brand called "${brand}".`,
    `Genre and mood: ${genres}.`,
    `Strict two-tone brand palette: near-black background (#0a0a0a) with poison acid-lime green (#9EF01A) as the only accent; small touches of desaturated bone white are OK.`,
    `Subject: a gritty ${genres} scene in the moshcoding house style — a mohawked skeleton hunched over a glowing laptop, code and sparks flying, torn distressed textures, halftone grit, high contrast.`,
    `Bold torn brush-stroke lettering. Screen-print / risograph feel. No real photos, no gradients-to-white, no other colors.`,
    `Centered composition, poster-like, 1:1.`,
  ].join(" ");
}

/** Generates the image, writes it to the cache, and returns the PNG bytes. */
export async function generateAndCache(brand: string, dn: string, styles: string[]): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: buildPrompt(brand, styles),
      size: "1024x1024",
      n: 1,
    }),
  });
  if (!res.ok) {
    console.error("openai image gen failed:", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return null;
  }
  const data: any = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachedPath(imageKey(dn, styles)), buf);
  } catch (err: any) {
    console.error("image cache write failed:", err?.message);
  }
  return buf;
}
