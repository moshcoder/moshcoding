"use client";
import { useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * Public "become an affiliate for this domain" widget shown on a tenant page.
 * Email-only signup → returns a domain-scoped referral link (80% free, 90-day
 * cookie). Mirrors WaitlistForm's UX.
 */
export default function AffiliateJoin({ dn }: { dn: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [result, setResult] = useState<{ shareUrl: string; commission_pct: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setMsg({ text: "That doesn't look like an email.", ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/affiliate/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), dn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something broke.");
      setResult({ shareUrl: data.shareUrl, commission_pct: data.commission_pct });
      setMsg({ text: `You're an affiliate for ${dn}. 🤘`, ok: true });
      setEmail("");
    } catch (err: any) {
      setMsg({ text: err.message || "Network died. Try again.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const copy = () => {
    if (!result) return;
    copyText(result.shareUrl).then((ok) =>
      setMsg({ text: ok ? "Link copied. 🤘" : "Couldn't copy — select the link and copy it.", ok }),
    );
  };

  const pct = result?.commission_pct ?? 80;
  return (
    <section className="t-aff" aria-label="Affiliate program">
      <h2 className="t-aff-h">Promote {dn} — earn {pct}%</h2>
      <p className="t-aff-sub">
        Join free, grab your link, and earn <b>{pct}% commission</b> on fees from everyone you refer.
        <b> 90-day cookie</b> — you get credited if they convert within 90 days.
      </p>

      {!result ? (
        <form className="wform" onSubmit={submit} noValidate>
          <input
            type="email" name="email" placeholder="you@dev.null" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn btn-acid" disabled={busy}>
            {busy ? "Summoning…" : "Become an affiliate"}
          </button>
        </form>
      ) : (
        <div className="t-aff-out">
          <p className="t-aff-label">Your referral link for {dn}:</p>
          <div className="t-aff-row">
            <input
              className="t-aff-link" readOnly value={result.shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-ghost" onClick={copy}>Copy</button>
          </div>
          <p className="t-aff-sub">Share it anywhere. Add a payout wallet in your <a href="/dashboard">dashboard</a> to get paid.</p>
        </div>
      )}

      <p className={`fmsg${msg ? (msg.ok ? " ok" : " err") : ""}`} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </p>
    </section>
  );
}
