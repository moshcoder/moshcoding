// Uploaded media (mp4 reels & clips). Bytes live on the filesystem under
// DATA_DIR — the SAME Railway volume that caches generated hero images
// (see lib/genart.ts) — while the row metadata lives in Turso (lib/db.ts).
// Mount a volume at DATA_DIR in production or uploads won't survive a redeploy.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const MEDIA_DIR = path.join(DATA_DIR, "media");

/** Cap per upload. Reels are short; keep them small enough to stream cheaply. */
export const MAX_UPLOAD_BYTES = Number(process.env.MEDIA_MAX_BYTES || 100 * 1024 * 1024); // 100 MB

/** Accepted video mime types → file extension. mp4 is the primary target. */
export const ALLOWED_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

export function isMp4Upload(name: string | undefined | null, type: string | undefined | null): boolean {
  const hasMp4Name = /\.mp4$/i.test(String(name || ""));
  const mime = String(type || "").trim().toLowerCase();
  return mime === "video/mp4" || ((mime === "" || mime === "application/octet-stream") && hasMp4Name);
}

function ensureDir(): void {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/** Absolute path for a stored file. `basename` guards against path traversal. */
export function mediaPath(filename: string): string {
  return path.join(MEDIA_DIR, path.basename(filename));
}

export async function writeMedia(filename: string, bytes: Buffer): Promise<void> {
  ensureDir();
  await fs.promises.writeFile(mediaPath(filename), bytes);
}

/** File size on disk, or null when the file is missing. */
export function mediaSize(filename: string): number | null {
  try {
    return fs.statSync(mediaPath(filename)).size;
  } catch {
    return null;
  }
}

/** Opens a (possibly partial) read stream for range-aware streaming. */
export function mediaStream(filename: string, start?: number, end?: number): fs.ReadStream {
  return fs.createReadStream(mediaPath(filename), start != null && end != null ? { start, end } : {});
}

export function deleteMediaFile(filename: string): void {
  try {
    fs.unlinkSync(mediaPath(filename));
  } catch {
    /* already gone — fine */
  }
}

// ---- poster thumbnails (ffmpeg) -------------------------------------------

/** The thumbnail name for a video file: `<name>.mp4` → `<name>_thumb.png`. */
export function thumbFilename(videoFilename: string): string {
  const base = path.basename(videoFilename).replace(/\.[^.]+$/, "");
  return `${base}_thumb.png`;
}

/** True once a poster thumbnail exists on disk for this video. */
export function hasThumb(videoFilename: string): boolean {
  return mediaSize(thumbFilename(videoFilename)) != null;
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Extracts a 640px poster frame from `inputPath` into `outputPath` (PNG) with
 * ffmpeg. Best-effort: returns false if ffmpeg is missing or the clip can't be
 * decoded — callers must not fail an upload on a false. Grabs a frame ~1s in,
 * falling back to the first frame for very short clips. Works on any absolute
 * paths, so it's shared by both video stores (media/ and videos/).
 */
export async function ffmpegPoster(inputPath: string, outputPath: string): Promise<boolean> {
  const frameAt = (t: string) =>
    ["-y", "-ss", t, "-i", inputPath, "-frames:v", "1", "-vf", "scale=640:-2", outputPath];
  if ((await runFfmpeg(frameAt("1"))) && fs.existsSync(outputPath)) return true;
  return (await runFfmpeg(frameAt("0"))) && fs.existsSync(outputPath);
}

/** Poster for an uploaded media-table reel: `<name>.mp4` → `<name>_thumb.png`. */
export async function generateThumbnail(videoFilename: string): Promise<boolean> {
  ensureDir();
  return ffmpegPoster(mediaPath(videoFilename), mediaPath(thumbFilename(videoFilename)));
}
