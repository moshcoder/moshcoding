import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Default social share image for tenant/parked-domain pages — on-brand
// #moshcoding: blacked-out with poison-green accents. Text is passed in by
// generateMetadata (app/page.tsx) so this route needs no DB/fs access.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const brand = (sp.get("brand") || "moshcoding").slice(0, 42);
  const headline = (sp.get("headline") || "IS COMING").slice(0, 42);
  const tagline = (sp.get("tagline") || "Code hard. Mosh harder.").slice(0, 90);
  const dn = (sp.get("dn") || "").slice(0, 60);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#080908",
          backgroundImage: "radial-gradient(120% 80% at 50% 130%, rgba(158,240,26,0.20), transparent 60%)",
          padding: "60px 72px",
          color: "#eef2e8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 16, height: 16, borderRadius: 99, background: "#1db954" }} />
          <div style={{ fontSize: 24, letterSpacing: 6, color: "#8b938a", textTransform: "uppercase" }}>
            A Spotify playlist for developers
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {dn ? <div style={{ fontSize: 28, color: "#8b938a", marginBottom: 10 }}>{dn}</div> : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 20, fontSize: 92, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
            <span>{brand}</span>
            <span style={{ color: "#9ef01a" }}>{headline}</span>
          </div>
          <div style={{ fontSize: 34, color: "#c9c9c9", marginTop: 22 }}>{tagline}</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26 }}>
          <div style={{ color: "#9ef01a", fontWeight: 800, letterSpacing: 2 }}>#MOSHCODING</div>
          <div style={{ display: "flex", color: "#566150", fontFamily: "monospace" }}>{"while(alive){ code(); mosh(); }"}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
