"use client";
import { useState } from "react";

const SOCIALS = [
  { key: "x", label: "X / Twitter", ph: "@handle" },
  { key: "github", label: "GitHub", ph: "username" },
  { key: "instagram", label: "Instagram", ph: "@handle" },
  { key: "tiktok", label: "TikTok", ph: "@handle" },
  { key: "bluesky", label: "Bluesky", ph: "@you.bsky.social" },
  { key: "youtube", label: "YouTube", ph: "@channel" },
];

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [wallet, setWallet] = useState("");
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const setHandle = (k: string, v: string) => setHandles((h) => ({ ...h, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const ref = new URLSearchParams(window.location.search).get("ref") || undefined;
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, domain: domain.trim(), handles, payoutWallet: wallet.trim(), ref }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed.");
      if (data.payUrl) { setMsg({ t: "Redirecting to your $1 checkout…", ok: true }); window.location.href = data.payUrl; return; }
      setMsg({ t: "You're in — setting up your page. 🤘", ok: true });
      window.location.href = data.redirect || "/dashboard";
    } catch (err: any) {
      setMsg({ t: err.message || "Something broke.", ok: false });
      setBusy(false);
    }
  }

  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Claim your page</h1><p className="sub">One-time <b>$1</b> via CoinPay sets up your linktree at moshcoding.com/?dn=your-domain.</p></div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>

      <p className="earn-banner">🤘 Earn up to <b>80% commission</b> on all fees generated with your custom affiliate code.</p>
      {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}

      <form className="card2" onSubmit={submit}>
        <h2>Account</h2>
        <div className="row"><input className="inp" type="email" placeholder="you@email.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="row"><input className="inp" type="password" placeholder="Password (min 8 chars)" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="row"><input className="inp" placeholder="your-domain.com" required value={domain} onChange={(e) => setDomain(e.target.value)} /></div>

        <h2 style={{ marginTop: 18 }}>Socials <span className="muted">(optional)</span></h2>
        {SOCIALS.map((s) => (
          <div className="row" key={s.key}>
            <span className="muted" style={{ width: 92, flex: "0 0 92px" }}>{s.label}</span>
            <input className="inp" placeholder={s.ph} value={handles[s.key] || ""} onChange={(e) => setHandle(s.key, e.target.value)} />
          </div>
        ))}

        <h2 style={{ marginTop: 18 }}>CoinPay payout wallet <span className="muted">(optional)</span></h2>
        <p className="sub">Where your future earnings/commissions get paid. You can add it later.</p>
        <div className="row"><input className="inp" placeholder="wallet address" value={wallet} onChange={(e) => setWallet(e.target.value)} /></div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn2" type="submit" disabled={busy}>{busy ? "Summoning…" : "Set it up — $1"}</button>
          <a className="btn2 ghost" href="/login">I already have an account</a>
        </div>
      </form>
    </div>
  );
}
