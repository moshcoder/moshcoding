import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { accountOwnsDomain, addMedia, listMedia, type Media } from "@/lib/db";
import { safeDomain } from "@/lib/config";
import { writeMedia, generateThumbnail, hasThumb, ALLOWED_TYPES, MAX_UPLOAD_BYTES, mediaTypeForUpload } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public view of a reel — the streaming URL, poster thumbnail + safe metadata. */
function mediaView(m: Media) {
  return {
    id: m.id,
    dn: m.dn,
    title: m.title || m.orig_name || "reel",
    content_type: m.content_type,
    size: m.size,
    created_at: m.created_at,
    url: `/api/media/${m.id}`,
    thumb: hasThumb(m.filename) ? `/api/media/${m.id}/thumb` : null,
  };
}

// List reels for a domain (public — reels are public content).
export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn") || "moshcoding.com");
  if (!dn) return bad("valid dn required");
  const rows = await listMedia(dn);
  return NextResponse.json({ dn, media: rows.map(mediaView) });
}

// Upload a reel to a parked domain the signed-in account owns (or as admin).
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const form = await req.formData().catch(() => null);
  if (!form) return bad("expected multipart/form-data");

  const dn = safeDomain(form.get("dn"));
  if (!dn) return bad("valid dn required");
  if (!(await accountOwnsDomain(accountId, dn))) {
    return bad("You don't own that domain.", 403);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return bad("file required");

  const type = mediaTypeForUpload(file.name, file.type);
  if (!type) return bad("Only mp4, webm or mov videos are allowed.");
  const ext = ALLOWED_TYPES[type];
  if (file.size > MAX_UPLOAD_BYTES) {
    return bad(`File too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB).`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const id = randomBytes(16).toString("hex");
  const filename = `${id}${ext}`;
  await writeMedia(filename, bytes);
  // Best-effort poster frame — never fail the upload if ffmpeg is unavailable.
  try { await generateThumbnail(filename); } catch { /* no poster, no problem */ }

  const title = String(form.get("title") || "").trim().slice(0, 120) || file.name;
  const media = await addMedia({
    id,
    dn,
    accountId,
    filename,
    origName: file.name,
    title,
    contentType: type,
    size: bytes.length,
  });
  return NextResponse.json({ media: mediaView(media) }, { status: 201 });
}
