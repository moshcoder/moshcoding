import type { TenantConfig } from "@/lib/config";
import WaitlistForm from "./WaitlistForm";
import AffiliateJoin from "./AffiliateJoin";
import SharePost from "./SharePost";
import LinkIcon, { kindFromUrl } from "./LinkIcon";
import CrawlProofAd from "./CrawlProofAd";
import CodeCopy from "./CodeCopy";
import { renderMarkdown } from "@/lib/markdown";

export default function Tenant({ cfg }: { cfg: TenantConfig }) {
  const accentStyle = {
    ["--tenant-accent" as any]: cfg.accent,
    ...(cfg.bgAccent ? { ["--tenant-bg-accent" as any]: cfg.bgAccent } : {}),
  } as React.CSSProperties;
  return (
    <div className="tenant" style={accentStyle}>
      <div className="tenant-wrap">
        <a className="powered" href="https://moshcoding.com" target="_blank" rel="noopener noreferrer">⚡ powered by <b>#moshcoding</b></a>
        {cfg.styles.length > 0 && (
          <img
            className="t-hero"
            src={`/api/og-image?dn=${encodeURIComponent(cfg.dn)}&style=${encodeURIComponent(cfg.styles.join(","))}`}
            alt={`${cfg.brand} — ${cfg.styles.join(", ")}`}
            width={320}
            height={320}
            loading="eager"
          />
        )}
        <p className="t-domain">{cfg.dn}</p>
        <h1 className="t-headline">{cfg.brand} <em>{cfg.headline}</em></h1>
        <p className="t-tag">{cfg.tagline}</p>
        <p className="t-sub">{cfg.sub}</p>

        {(cfg.audioStream || cfg.videoStream) && (
          <div className="t-streams">
            {cfg.audioStream && (
              <a className="t-stream" href={cfg.audioStream} target="_blank" rel="noopener noreferrer">🎧 Listen</a>
            )}
            {cfg.videoStream && (
              <a className="t-stream" href={cfg.videoStream} target="_blank" rel="noopener noreferrer">📺 Watch</a>
            )}
          </div>
        )}

        <WaitlistForm dn={cfg.dn} cta={cfg.cta} big />

        {cfg.hashtags.length > 0 ? (
          <p className="t-hashtag">{cfg.hashtags.map((h) => `#${h}`).join(" ")}</p>
        ) : cfg.hashtag ? <p className="t-hashtag">{cfg.hashtag}</p> : null}

        {cfg.codeBlock ? <pre className="t-code">{cfg.codeBlock}</pre> : null}

        {cfg.blocks.length > 0 && (
          <div className="t-blocks">
            {cfg.blocks.map((b) => (
              <div key={b.id} className="t-block" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.content) }} />
            ))}
            <CodeCopy />
          </div>
        )}

        <SharePost cfg={cfg} />
        {cfg.links.length > 0 && (
          <nav className="links" aria-label="Social links">
            {cfg.links.map((l, i) => {
              const kind = l.kind || kindFromUrl(l.url);
              return (
                <a key={i} className="lt" href={l.url} target="_blank" rel="noopener noreferrer">
                  <span className="lt-i" aria-hidden="true"><LinkIcon kind={kind} /></span>
                  <span className="lt-l">{l.label}</span>
                  <span className="lt-go" aria-hidden="true">↗</span>
                </a>
              );
            })}
          </nav>
        )}

        {cfg.sponsors.length > 0 && (
          <nav className="links sponsors" aria-label="Sponsors">
            <p className="sponsors-h">Sponsors</p>
            {cfg.sponsors.map((l, i) => (
              <a key={i} className="lt" href={l.url} target="_blank" rel="noopener noreferrer sponsored">
                <span className="lt-i" aria-hidden="true"><LinkIcon kind={l.kind || "sponsor"} /></span>
                <span className="lt-l">{l.label}</span>
                <span className="lt-go" aria-hidden="true">↗</span>
              </a>
            ))}
          </nav>
        )}

        {cfg.videos.length > 0 && (
          <div id="videos" className="t-videos" aria-label="Videos">
            {cfg.videos.map((v, i) => (
              <video key={i} className="t-video" controls preload="metadata" playsInline src={v.url} poster={v.poster || undefined} />
            ))}
          </div>
        )}

        {cfg.assets.length > 0 && (
          <div className="t-assets" aria-label="Assets">
            {cfg.assets.map((a, i) =>
              a.kind === "video" ? (
                <video key={i} className="t-asset t-asset-av" controls preload="metadata" playsInline src={a.url} title={a.label} />
              ) : a.kind === "audio" ? (
                <audio key={i} className="t-asset t-asset-audio" controls preload="none" src={a.url} title={a.label} />
              ) : (
                <a key={i} className="t-asset" href={a.url} target="_blank" rel="noopener noreferrer" title={a.label}>
                  <img src={a.url} alt={a.label} loading="lazy" />
                </a>
              ),
            )}
          </div>
        )}

        <AffiliateJoin dn={cfg.dn} />

        <a className="t-bid" href={`/?bid=${encodeURIComponent(cfg.dn)}`}>💰 Bid on this domain</a>

        {cfg.adSlot && <CrawlProofAd slot={cfg.adSlot} format={cfg.adFormat} />}

        <footer className="t-foot">
          &copy; 2026 <a href="https://moshcoding.com" target="_blank" rel="noopener noreferrer">powered by moshcoding.com</a>
        </footer>
      </div>
    </div>
  );
}
