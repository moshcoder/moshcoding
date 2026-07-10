"use client";
import { useState } from "react";

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function BidForm({
  dn,
  buyNowCents,
  highBidCents,
}: {
  dn: string;
  buyNowCents: number | null;
  highBidCents: number | null;
}) {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [high, setHigh] = useState<number | null>(highBidCents);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [done, setDone] = useState(false);

  async function place(bidAmount: string) {
    setMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setMsg({ text: "Enter a valid email to place a bid.", ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bids", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dn, email: email.trim(), amount: bidAmount, message: message.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not place bid.");
      setMsg({ text: data.message || "Bid placed. 🤘", ok: true });
      if (typeof data.amountCents === "number") setHigh(data.amountCents);
      if (data.won) setDone(true);
      setAmount("");
    } catch (err: any) {
      setMsg({ text: err.message || "Network died. Try again.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="fmsg ok" role="status">
        {msg?.text ?? "You won this domain. 🤘"}
      </p>
    );
  }

  return (
    <>
      <form className="bidform" onSubmit={(e) => { e.preventDefault(); place(amount); }} noValidate>
        <input
          type="email" name="email" placeholder="you@dev.null" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <div className="bid-amount">
          <span className="bid-cur">$</span>
          <input
            type="number" name="amount" min="1" step="1" inputMode="decimal"
            placeholder={high != null ? String(Math.floor(high / 100) + 1) : "Your bid (USD)"}
            required value={amount} onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <textarea
          name="message" rows={2} placeholder="Optional note to the owner"
          value={message} onChange={(e) => setMessage(e.target.value)}
        />
        <button type="submit" className="btn btn-acid" disabled={busy}>
          {busy ? "Placing…" : "Place bid"}
        </button>
      </form>

      {buyNowCents != null && (
        <button
          type="button" className="btn btn-ghost buy-now" disabled={busy}
          onClick={() => place(String(buyNowCents / 100))}
        >
          Buy it now — {money(buyNowCents)}
        </button>
      )}

      <p className={`fmsg${msg ? (msg.ok ? " ok" : " err") : ""}`} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </p>
    </>
  );
}
