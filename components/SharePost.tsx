"use client";
import { useMemo, useState } from "react";
import type { TenantConfig } from "@/lib/config";

// "Post to socials" — composes a ready-to-paste post (@handle + #hashtags) and
// offers one-click share on the networks that support a prefill intent (X,
// Bluesky, Threads, Facebook) plus a copy button for the ones that don't
// (Instagram, TikTok). No modals.
export default function SharePost({ cfg }: { cfg: TenantConfig }) {
  const [copied, setCopied] = useState<string | null>(null);

  const { text, url, shareText } = useMemo(() => {
    const tags = cfg.hashtags.map((h) => `#${h}`).join(" ");
    const handle =
      cfg.links.find((l) => l.kind === "x")?.label ||
      cfg.links.find((l) => ["bluesky", "instagram", "tiktok"].includes(l.kind || ""))?.label ||
      "";
    const parts = [`${cfg.brand} ${cfg.headline} — join the waitlist 🤘`, tags, handle].filter(Boolean);
    const text = parts.join(" ");
    // Drive people to the tenant's own (parked) domain, not the moshcoding URL.
    const url = `https://${cfg.dn}`;
    return { text, url, shareText: `${text} ${url}` };
  }, [cfg]);

  const enc = encodeURIComponent;
  const intents = [
    { key: "x", label: "X", href: `https://x.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
    { key: "bluesky", label: "Bluesky", href: `https://bsky.app/intent/compose?text=${enc(shareText)}` },
    { key: "threads", label: "Threads", href: `https://www.threads.net/intent/post?text=${enc(shareText)}` },
    { key: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
  ];

  const copyFor = async (label: string) => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(label);
      setTimeout(() => setCopied(null), 2200);
    } catch { setCopied(null); }
  };

  return (
    <section className="share">
      <p className="share-h">Post it</p>
      <div className="share-row">
        {intents.map((t) => (
          <a key={t.key} className="share-btn" href={t.href} target="_blank" rel="noopener noreferrer">{t.label}</a>
        ))}
        {/* No prefill intent — copy the post, then paste into the app. */}
        <button type="button" className="share-btn" onClick={() => copyFor("Instagram")}>Instagram</button>
        <button type="button" className="share-btn" onClick={() => copyFor("TikTok")}>TikTok</button>
        <button type="button" className="share-btn primary" onClick={() => copyFor("clipboard")}>
          {copied ? "Copied 🤘" : "Copy post"}
        </button>
      </div>
      {copied && copied !== "clipboard" && (
        <p className="share-note">Copied — paste it into {copied}.</p>
      )}
    </section>
  );
}
