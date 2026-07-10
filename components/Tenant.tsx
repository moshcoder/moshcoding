import type { TenantConfig } from "@/lib/config";
import WaitlistForm from "./WaitlistForm";
import LinkIcon, { kindFromUrl } from "./LinkIcon";

export default function Tenant({ cfg }: { cfg: TenantConfig }) {
  const accentStyle = { ["--tenant-accent" as any]: cfg.accent } as React.CSSProperties;
  return (
    <div className="tenant" style={accentStyle}>
      <div className="tenant-wrap">
        <a className="powered" href="https://moshcoding.com" rel="noopener noreferrer">⚡ powered by <b>#moshcoding</b></a>
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

        <WaitlistForm dn={cfg.dn} cta={cfg.cta} big />

        {cfg.hashtag ? <p className="t-hashtag">{cfg.hashtag}</p> : null}
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

        <footer className="t-foot">
          &copy; 2026 <a href="https://moshcoding.com" rel="noopener noreferrer">powered by moshcoding.com</a>
        </footer>
      </div>
    </div>
  );
}
