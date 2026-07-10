import { NextRequest } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_DIR = process.env.VIDEO_DIR || path.join(process.cwd(), ".data", "videos");

// GET /api/media/<domain>/<file> — streams an uploaded video (public), with HTTP
// range support so browsers can seek. Path is sanitized to prevent traversal.
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path || [];
  const rel = parts.map((p) => p.replace(/[^A-Za-z0-9._-]/g, "")).filter(Boolean).join("/");
  const full = path.resolve(VIDEO_DIR, rel);
  if (!full.startsWith(path.resolve(VIDEO_DIR) + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }

  let stat: fs.Stats;
  try { stat = await fsp.stat(full); if (!stat.isFile()) throw 0; } catch { return new Response("not found", { status: 404 }); }

  const size = stat.size;
  const ext = path.extname(full).toLowerCase();
  const type =
    ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
    : ext === ".webm" ? "video/webm"
    : ext === ".mov" ? "video/quicktime"
    : "video/mp4";
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;
    if (start > end) return new Response("range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });
    const nodeStream = fs.createReadStream(full, { start, end });
    return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "cache-control": "public, max-age=86400",
      },
    });
  }

  const nodeStream = fs.createReadStream(full);
  return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "content-type": type,
      "accept-ranges": "bytes",
      "content-length": String(size),
      "cache-control": "public, max-age=86400",
    },
  });
}
