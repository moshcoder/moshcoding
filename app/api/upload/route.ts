import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { findOrCreateAccountByEmail, ownsParkedDomain, getTenantConfig, upsertTenant } from "@/lib/db";
import { safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_DIR = process.env.VIDEO_DIR || path.join(process.cwd(), ".data", "videos");
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

async function accountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

const domSlug = (dn: string) => dn.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");

// POST /api/upload?dn=<domain>  (multipart, field "file") — stores an MP4 on the
// volume and appends it to the domain's config.videos.
export async function POST(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Bad upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  const isMp4 = /\.mp4$/i.test(file.name) || /video\/mp4|application\/octet-stream/.test(file.type);
  if (!isMp4) return NextResponse.json({ error: "MP4 files only." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Too big — 100 MB max." }, { status: 413 });

  const dir = path.join(VIDEO_DIR, domSlug(dn));
  await fs.mkdir(dir, { recursive: true });
  const safeBase = (file.name || "video.mp4").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(0, 80);
  const fname = `${Date.now().toString(36)}-${safeBase.endsWith(".mp4") ? safeBase : safeBase + ".mp4"}`;
  await fs.writeFile(path.join(dir, fname), Buffer.from(await file.arrayBuffer()));

  const url = `/api/media/${domSlug(dn)}/${fname}`;
  const config: any = (await getTenantConfig(dn)) || {};
  const videos = Array.isArray(config.videos) ? config.videos : [];
  videos.unshift({ name: (file.name || fname).slice(0, 120), url });
  config.videos = videos.slice(0, 24);
  await upsertTenant(dn, id, config);

  return NextResponse.json({ ok: true, video: { name: (file.name || fname).slice(0, 120), url }, videos: config.videos });
}

// DELETE /api/upload?dn=<domain>&url=/api/media/... — remove a video.
export async function DELETE(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });
  const url = req.nextUrl.searchParams.get("url") || "";
  const config: any = (await getTenantConfig(dn)) || {};
  const videos = Array.isArray(config.videos) ? config.videos : [];
  config.videos = videos.filter((v: any) => v?.url !== url);
  await upsertTenant(dn, id, config);
  // Best-effort delete the file (path is validated to be under this domain's dir).
  const m = /^\/api\/media\/([a-z0-9.-]+)\/([A-Za-z0-9._-]+)$/.exec(url);
  if (m && m[1] === domSlug(dn)) {
    fs.unlink(path.join(VIDEO_DIR, m[1], m[2])).catch(() => {});
  }
  return NextResponse.json({ ok: true, videos: config.videos });
}
