"use client";

import { useCallback, useState } from "react";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; tld: string }
  | { state: "taken"; tld: string; reason: string }
  | { state: "invalid"; reason: string }
  | { state: "claimed"; tld: string }
  | { state: "error"; reason: string };

/**
 * Search-and-claim for the Moshpit namespace.
 *
 * Availability is a plain GET with no auth, so the answer is the same whether
 * or not you are signed in — the sign-in wall belongs on the claim, not on
 * finding out whether the name you want exists.
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
      if (data.available) return setCheck({ state: "available", tld: data.tld });
      // A 400 means the input could never be a TLD; anything else means the
      // name is real but unavailable. Those read very differently to a user.
      if (res.status === 400) return setCheck({ state: "invalid", reason: data.reason });
      setCheck({ state: "taken", tld: data.tld, reason: data.reason });
    } catch {
      setCheck({ state: "error", reason: "could not reach the registry" });
    }
  }, []);

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
      if (!res.ok) {
        return setCheck(
          res.status === 409
            ? { state: "taken", tld, reason: "someone claimed it first" }
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
              Claim .{check.tld}
            </button>
          </>
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
