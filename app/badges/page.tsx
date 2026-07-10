import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "#BADGES — moshcoding media kit",
  description: "Grab moshcoding badges, banners & brand art. Right-click to save, or click to open full-size.",
};

/** All brand thumbs served from public/badges (populated from images/*_thumb.png). */
function badgeFiles(): string[] {
  try {
    const dir = path.join(process.cwd(), "public", "badges");
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
  } catch {
    return [];
  }
}

function label(file: string): string {
  return file.replace(/\.png$/i, "").replace(/-/g, " ").replace(/\bthumb\b/i, "").trim();
}

export default function BadgesPage() {
  const files = badgeFiles();
  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>#BADGES</h1>
          <p className="sub">Rep the pit. Right-click → save, or click any tile to open it full-size. {files.length} assets.</p>
        </div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>

      {files.length === 0 ? (
        <p className="sub">No badges yet.</p>
      ) : (
        <div className="badge-grid">
          {files.map((f) => (
            <a key={f} className="badge-cell" href={`/badges/${f}`} target="_blank" rel="noopener noreferrer" title={label(f)}>
              <img src={`/badges/${f}`} alt={label(f)} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
