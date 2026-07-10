import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { listMedia } from "@/lib/db";
import { hasThumb } from "@/lib/media";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "#VIDEOS — moshcoding reels",
  description: "moshcoding mp4 reels & clips. Code hard, mosh harder — watch the pit.",
};

type Reel = { src: string; title: string; portrait: boolean; poster?: string };

/** Built-in brand reels shipped in public/videos (poster = <name>_thumb.png if present). */
function builtinReels(): Reel[] {
  try {
    const dir = path.join(process.cwd(), "public", "videos");
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.toLowerCase().endsWith(".mp4"))
      .sort()
      .map((f) => {
        const thumb = f.replace(/\.mp4$/i, "_thumb.png");
        return {
          src: `/videos/${f}`,
          title: f.replace(/\.mp4$/i, "").replace(/-/g, " ").trim(),
          portrait: /9x16/i.test(f),
          poster: files.includes(thumb) ? `/videos/${thumb}` : undefined,
        };
      });
  } catch {
    return [];
  }
}

/** Reels uploaded to the main gallery from the dashboard (best-effort; DB may be off in dev). */
async function uploadedReels(): Promise<Reel[]> {
  try {
    const rows = await listMedia("moshcoding.com");
    return rows.map((m) => ({
      src: `/api/media/${m.id}`,
      title: m.title || m.orig_name || "reel",
      portrait: false,
      poster: hasThumb(m.filename) ? `/api/media/${m.id}/thumb` : undefined,
    }));
  } catch {
    return [];
  }
}

export default async function VideosPage() {
  const reels = [...(await uploadedReels()), ...builtinReels()];
  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>#VIDEOS</h1>
          <p className="sub">
            mp4 reels &amp; clips — code hard, mosh harder. {reels.length} clip{reels.length === 1 ? "" : "s"}.
          </p>
        </div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>

      {reels.length === 0 ? (
        <p className="sub">No videos yet.</p>
      ) : (
        <div className="video-grid">
          {reels.map((r) => (
            <figure key={r.src} className={`video-cell${r.portrait ? " portrait" : ""}`}>
              <video src={r.src} poster={r.poster} controls preload="metadata" playsInline />
              <figcaption>{r.title}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
