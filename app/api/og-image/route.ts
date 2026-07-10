import { NextRequest } from "next/server";
import { safeDomain, parseStyles, configFor } from "@/lib/config";
import { imagesEnabled, imageKey, readCached, generateAndCache } from "@/lib/genart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // image generation can take a while

// de-dupe concurrent first-loads for the same key within a process
const inflight = new Map<string, Promise<Buffer | null>>();

export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return new Response("invalid domain", { status: 400 });
  const styles = parseStyles(req.nextUrl.searchParams.get("style"));
  const key = imageKey(dn, styles);

  const serve = (buf: Buffer) =>
    new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });

  const cached = readCached(key);
  if (cached) return serve(cached);
  if (!imagesEnabled()) return new Response("image generation not configured", { status: 404 });

  const brand = configFor(dn).brand;
  let promise = inflight.get(key);
  if (!promise) {
    promise = generateAndCache(brand, dn, styles).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  const buf = await promise;
  if (!buf) return new Response("image generation failed", { status: 502 });
  return serve(buf);
}
