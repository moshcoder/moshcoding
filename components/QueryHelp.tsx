"use client";
import { useRef } from "react";

const PARAMS: { p: string; d: string; ex?: string }[] = [
  { p: "dn=<domain>", d: "The domain to brand (required for a tenant page).", ex: "?dn=killer-startup.io" },
  { p: "socials=<handle>", d: "One handle broadcast to X / Instagram / TikTok.", ex: "?dn=x.io&socials=@mybrand" },
  { p: "social_<platform>=<handle>", d: "Per-platform handle. platforms: x, bluesky, instagram, tiktok, github, youtube (aliases: twitter, bsky, ig, gh, yt, tt).", ex: "?dn=x.io&social_x=@a&social_bluesky=@b.bsky.social" },
  { p: "fallback=<domain|url>", d: "Sets the website link AND seeds the generic social handle from that name.", ex: "?dn=x.io&fallback=coolstartup.com" },
  { p: "link_1=…&link_2=…", d: "Custom links after the socials. Value = bare/full URL, or \"Label|https://url\".", ex: "?dn=x.io&link_1=Docs|https://docs.example.com" },
  { p: "aff_link1=…&aff_link2=…", d: "Affiliate links shown under a “Sponsors” heading.", ex: "?dn=x.io&aff_link1=Sponsor|https://sponsor.com" },
  { p: "hashtags=<kw1,kw2>", d: "Bare keywords rendered as #kw1 #kw2 (special chars stripped). Defaults to the domain name.", ex: "?dn=x.io&hashtags=moshcoding,metal" },
  { p: "style=<genre,genre>", d: "Genres that drive the AI hero image (metal, punk, hardcore, deathcore…).", ex: "?dn=x.io&style=deathcore,hardcore" },
  { p: "fg_rgba=<rgba>", d: "Foreground accent. Full rgba() or bare numbers. Defaults to moshcoding green.", ex: "?dn=x.io&fg_rgba=255,0,80,1" },
  { p: "bg_rgba=<rgba>", d: "Background tint. Full rgba() or bare numbers.", ex: "?dn=x.io&bg_rgba=rgba(0,0,0,.6)" },
  { p: "stream=<url>", d: "Adds a ▶ Stream button linking to a playlist/stream.", ex: "?dn=x.io&stream=https://open.spotify.com/playlist/..." },
  { p: "ref=<code>", d: "Referral code — attributes any waitlist signup on the page to you.", ex: "?dn=x.io&ref=YOURCODE" },
];

const EXAMPLES: { label: string; href: string }[] = [
  { label: "Domain + app link + hashtags", href: "/?dn=tronbrowser.dev&link_1=http://tronbrowser.dev&hashtags=moshcoding,tronbrowser" },
  { label: "Domain + named app link", href: "/?dn=tronbrowser.dev&link_1=TronBrowser|https://tronbrowser.dev" },
  { label: "Per-platform socials + hashtags", href: "/?dn=killer-startup.io&social_x=killerstartup&social_bluesky=killer.bsky.social&hashtags=moshcoding,launch" },
  { label: "Custom red accent + dark tint", href: "/?dn=my-band.io&style=deathcore&fg_rgba=255,0,80,1&bg_rgba=0,0,0,.55" },
  { label: "Stream + sponsor + ref", href: "/?dn=x.io&stream=https://open.spotify.com/playlist/37i9dQZF1DX&aff_link1=Sponsor|https://sponsor.com&ref=YOURCODE" },
];

export default function QueryHelp() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="qhelp-btn" aria-label="Supported URL parameters" onClick={() => ref.current?.showModal()}>?</button>
      <dialog ref={ref} className="qhelp" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="qhelp-inner">
          <div className="qhelp-head">
            <h3>URL params <span className="muted">— brand any domain with a link</span></h3>
            <button type="button" className="qhelp-x" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
          </div>
          <p className="qhelp-note">Append to <code>moshcoding.com/?dn=&lt;domain&gt;</code>. Chain params with <code>&amp;</code>. These work free, no account.</p>
          <div className="qhelp-list">
            {PARAMS.map((x) => (
              <div className="qhelp-row" key={x.p}>
                <code className="qhelp-p">{x.p}</code>
                <span className="qhelp-d">{x.d}{x.ex ? <><br /><span className="qhelp-ex">{x.ex}</span></> : null}</span>
              </div>
            ))}
          </div>
          <h4 className="qhelp-exh">Cool examples</h4>
          <ul className="qhelp-ex-list">
            {EXAMPLES.map((e) => (
              <li key={e.href}><a href={e.href} target="_blank" rel="noopener noreferrer">{e.label} ↗</a></li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
