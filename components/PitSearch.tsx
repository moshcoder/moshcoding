"use client";

import { useCallback, useEffect, useState } from "react";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; tld: string; price: string | null }
  | { state: "taken"; tld: string; reason: string }
  | { state: "invalid"; reason: string }
  | { state: "claimed"; tld: string }
  | { state: "settling"; tld: string }
  | { state: "refund"; tld: string }
  | { state: "error"; reason: string };

/** How long to keep asking whether a payment landed before saying so plainly. */
const SETTLE_POLL_MS = 3000;
const SETTLE_ATTEMPTS = 40;

/** "10.00" -> "$10", "9.50" -> "$9.50" — trailing ".00" is noise on a button. */
function money(price: string): string {
  return `$${price.replace(/\.00$/, "")}`;
}

/**
 * Search-and-claim for the Moshpit namespace.
 *
 * Availability is a plain GET with no auth, so the answer is the same whether
 * or not you are signed in — the sign-in wall belongs on the claim, not on
 * finding out whether the name you want exists. The price rides along on that
 * same answer, so the button can say what it costs before it is pressed.
 */
export default function PitSearch() {
  const [value, setValue] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });

  const lookup = useCallback(async (raw: string) => {
    const tld = raw.trim().toLowerCase().replace(/^\.+/, "");
    if (!tld) return setCheck({ state: "idle" });
    setCheck({ state: "checking" });
    try {
      const res = await fetch(`/api/moshpit/tlds/${encodeURIComponent(tld)}`);
      const data = await res.json();
      if (data.available) {
        return setCheck({ state: "available", tld: data.tld, price: data.price_usd ?? null });
      }
      // A 400 means the input could never be a TLD; anything else means the
      // name is real but unavailable. Those read very differently to a user.
      if (res.status === 400) return setCheck({ state: "invalid", reason: data.reason });
      setCheck({ state: "taken", tld: data.tld, reason: data.reason });
    } catch {
      setCheck({ state: "error", reason: "could not reach the registry" });
    }
  }, []);

  /**
   * Follow a claim until the money confirms.
   *
   * The hosted pay page sends the customer back the moment they have paid,
   * which is usually before the webhook has arrived, so the first read is
   * expected to still say "pending". Reporting that as failure would tell
   * someone who just paid that nothing happened.
   */
  const watchClaim = useCallback(async (claimId: string) => {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`/api/moshpit/claims/${encodeURIComponent(claimId)}`);
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(`/pit?claim=${claimId}`)}`;
          return;
        }
        if (!res.ok) return setCheck({ state: "error", reason: "could not find that claim" });
        const data = await res.json();

        if (data.status === "registered") return setCheck({ state: "claimed", tld: data.tld });
        if (data.status === "refund_due") return setCheck({ state: "refund", tld: data.tld });
        if (data.status === "expired") {
          return setCheck({ state: "taken", tld: data.tld, reason: "the hold on it ran out" });
        }
        setCheck({ state: "settling", tld: data.tld });
      } catch {
        // A dropped request mid-poll is not an answer; keep asking.
      }
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
    setCheck({
      state: "error",
      reason: "this is taking longer than expected — your payment is safe, check back shortly",
    });
  }, []);

  // Coming back from the hosted pay page.
  useEffect(() => {
    const claimId = new URLSearchParams(window.location.search).get("claim");
    if (!claimId) return;
    setCheck({ state: "settling", tld: "" });
    void watchClaim(claimId);
  }, [watchClaim]);

  const claim = useCallback(async (tld: string) => {
    setCheck({ state: "checking" });
    try {
      const res = await fetch("/api/moshpit/tlds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tld }),
      });
      if (res.status === 401) {
        // Send them back here afterwards, not to a generic dashboard — they
        // came to claim a specific name.
        window.location.href = `/login?next=${encodeURIComponent("/pit")}`;
        return;
      }
      const data = await res.json();

      // 402: the ending is held for us and there is somewhere to go and pay.
      if (res.status === 402 && data.pay_url) {
        window.location.href = data.pay_url;
        return;
      }

      if (!res.ok) {
        return setCheck(
          res.status === 409
            ? { state: "taken", tld, reason: data.error || "someone claimed it first" }
            : { state: "error", reason: data.error || "could not register that TLD" },
        );
      }
      setCheck({ state: "claimed", tld: data.tld.tld });
    } catch {
      setCheck({ state: "error", reason: "could not reach the registry" });
    }
  }, []);

  return (
    <div className="pit-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(value);
        }}
      >
        <label className="pit-field">
          <span className="pit-dot">.</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCheck({ state: "idle" });
            }}
            placeholder="eggs"
            aria-label="the TLD you want"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="btn btn-acid" type="submit" disabled={check.state === "checking"}>
          {check.state === "checking" ? "checking…" : "Check it"}
        </button>
      </form>

      <div className="pit-result" role="status" aria-live="polite">
        {check.state === "available" && (
          <>
            <p className="pit-yes">
              <strong>.{check.tld}</strong> is free.
            </p>
            <button className="btn btn-acid" onClick={() => claim(check.tld)}>
              {check.price ? `Claim .${check.tld} — ${money(check.price)}` : `Claim .${check.tld}`}
            </button>
            {check.price && (
              <p className="pit-lede pit-dim">
                Paid once in USDC on Polygon. Yours to keep or sell after that.
              </p>
            )}
          </>
        )}
        {check.state === "settling" && (
          <p className="pit-yes">
            Confirming your payment{check.tld ? ` for .${check.tld}` : ""}… this can take a minute.
          </p>
        )}
        {check.state === "refund" && (
          <p className="pit-no">
            <strong>.{check.tld}</strong> went to someone else while your payment was confirming.
            You have not lost the money — we owe you a refund and it is on our list.
          </p>
        )}
        {check.state === "taken" && (
          <p className="pit-no">
            <strong>.{check.tld}</strong> — {check.reason}.
          </p>
        )}
        {check.state === "invalid" && <p className="pit-no">{check.reason}</p>}
        {check.state === "error" && <p className="pit-no">{check.reason}</p>}
        {check.state === "claimed" && (
          <p className="pit-yes">
            <strong>.{check.tld}</strong> is yours. Everything under it is yours to sell.
          </p>
        )}
      </div>
    </div>
  );
}
