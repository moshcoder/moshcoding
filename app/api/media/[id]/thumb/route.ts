import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getMedia } from "@/lib/db";
import { mediaSize, mediaStream, thumbFilename } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the poster thumbnail (<name>_thumb.png) generated on upload.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const m = await getMedia(id);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tf = thumbFilename(m.filename);
  const size = mediaSize(tf);
  if (size == null) return NextResponse.json({ error: "No thumbnail" }, { status: 404 });

  const stream = Readable.toWeb(mediaStream(tf)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
