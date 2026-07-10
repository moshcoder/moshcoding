"use client";
import { useState } from "react";

export default function WaitlistForm({
  dn = null,
  cta = "Join the waitlist",
  big = false,
  placeholder = "you@dev.null",
}: {
  dn?: string | null;
  cta?: string;
  big?: boolean;
  placeholder?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setMsg({ text: "That doesn't look like an email.", ok: false });
      return;
    }
    setBusy(true);
    try {
      // Carry a ?ref=<code> referral through to the signup for attribution.
      const ref =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("ref")
          : null;
      const payload: Record<string, string> = { email: email.trim() };
      if (dn) payload.dn = dn;
      if (ref) payload.ref = ref;
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something broke.");
      const text = data.verified
        ? "You're already confirmed. 🤘"
        : data.pending
          ? "Check your inbox to confirm your spot. 🤘"
          : data.already
            ? "You're already in the pit. 🤘"
            : "You're in. 🤘";
      setMsg({ text, ok: true });
      setEmail("");
    } catch (err: any) {
      setMsg({ text: err.message || "Network died. Try again.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className={`wform${big ? " big" : ""}`} onSubmit={submit} noValidate>
        <input
          type="email" name="email" placeholder={placeholder} required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn-acid" disabled={busy}>
          {busy ? "Summoning…" : cta}
        </button>
      </form>
      <p className={`fmsg${msg ? (msg.ok ? " ok" : " err") : ""}`} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </p>
    </>
  );
}
