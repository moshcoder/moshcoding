"use client";
import { useEffect, useState } from "react";

export default function ResetPage() {
  // token read from the URL client-side (avoids Next's useSearchParams Suspense).
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
    setReady(true);
  }, []);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await fetch("/api/auth/reset", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setMsg({ t: "If that email has an account, a reset link is on its way. 🤘", ok: true });
    } catch {
      setMsg({ t: "Something broke. Try again.", ok: false });
    } finally { setBusy(false); }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset/confirm", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed.");
      setMsg({ t: "Password updated. Redirecting to login…", ok: true });
      setTimeout(() => { window.location.href = "/login"; }, 1200);
    } catch (err: any) {
      setMsg({ t: err.message, ok: false });
      setBusy(false);
    }
  }

  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>{token ? "Set a new password" : "Reset password"}</h1></div>
        <a className="btn2 ghost" href="/login">← login</a>
      </div>
      {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}
      {!ready ? null : token ? (
        <form className="card2" onSubmit={confirm}>
          <div className="row"><input className="inp" type="password" placeholder="New password (min 8 chars)" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="row" style={{ marginTop: 6 }}><button className="btn2" type="submit" disabled={busy}>{busy ? "…" : "Update password"}</button></div>
        </form>
      ) : (
        <form className="card2" onSubmit={request}>
          <p className="sub">Enter your account email and we'll send a reset link.</p>
          <div className="row"><input className="inp" type="email" placeholder="you@email.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="row" style={{ marginTop: 6 }}><button className="btn2" type="submit" disabled={busy}>{busy ? "…" : "Send reset link"}</button></div>
        </form>
      )}
    </div>
  );
}
