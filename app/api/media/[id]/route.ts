import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { accountOwnsDomain, getMedia, deleteMedia } from "@/lib/db";
import { parseHttpByteRange } from "@/lib/http-range";
import { mediaSize, mediaStream, deleteMediaFile, thumbFilename } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream a reel with HTTP range support so <video> can seek/scrub.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const m = await getMedia(id);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const size = mediaSize(m.filename);
  if (size == null) return NextResponse.json({ error: "File missing" }, { status: 404 });

  const baseHeaders: Record<string, string> = {
    "content-type": m.content_type,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };

  const range = req.headers.get("range");
  if (range) {
    const parsed = parseHttpByteRange(range, size);
    if (!parsed) {
      return new NextResponse(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" },
      });
    }
    const { start, end } = parsed;
    const stream = Readable.toWeb(mediaStream(m.filename, start, end)) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(mediaStream(m.filename)) as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...baseHeaders, "content-length": String(size) } });
}

// Delete a reel (owner of its domain, or admin).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  const { id } = await ctx.params;
  const m = await getMedia(id);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await accountOwnsDomain(accountId, m.dn))) return bad("You don't own that domain.", 403);

  const removed = await deleteMedia(id);
  if (removed) {
    deleteMediaFile(removed.filename);
    deleteMediaFile(thumbFilename(removed.filename)); // drop its poster too
  }
  return NextResponse.json({ ok: true });
}
