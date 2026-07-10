"use client";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [coinpay, setCoinpay] = useState(false);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((m) => {
      if (m?.user) { window.location.href = "/dashboard"; return; }
      setCoinpay(Boolean(m?.coinpayEnabled));
    }).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed.");
      window.location.href = "/dashboard";
    } catch (err: any) {
      setMsg({ t: err.message || "Something broke.", ok: false });
      setBusy(false);
    }
  }

  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Log in</h1><p className="sub">Manage your page, socials &amp; payout wallet.</p></div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>
      {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}

      <form className="card2" onSubmit={submit}>
        <div className="row"><input className="inp" type="email" placeholder="you@email.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="row"><input className="inp" type="password" placeholder="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn2" type="submit" disabled={busy}>{busy ? "…" : "Log in"}</button>
          <a className="btn2 ghost" href="/reset">Forgot password?</a>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>No account? <a href="/signup">Claim your page — $1</a></p>
        {coinpay && (
          <>
            <p className="sub" style={{ marginTop: 12 }}>— or —</p>
            <a className="btn2 ghost" href="/auth/login">Log in with CoinPay</a>
          </>
        )}
      </form>
    </div>
  );
}
