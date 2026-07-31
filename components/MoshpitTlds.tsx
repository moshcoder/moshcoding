"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Operator controls for the TLDs you hold.
 *
 * The alias and exemption APIs already existed but had no UI, which made them
 * effectively operator-only-if-you-can-write-curl. Pointing `.agentic` at
 * `.agent` is exactly the kind of thing an operator wants to do on a whim and
 * undo just as fast, so it belongs on a page.
 */

type Tld = {
  tld: string;
  owner_email: string | null;
  alias_of: string | null;
  created_at: string;
};

export default function MoshpitTlds() {
  const [tlds, setTlds] = useState<Tld[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [claim, setClaim] = useState("");
  const [aliasTarget, setAliasTarget] = useState<Record<string, string>>({});
  const [exempt, setExempt] = useState<Record<string, string[]>>({});
  const [exemptDraft, setExemptDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/moshpit/tlds?mine=1", { cache: "no-store" });
      if (res.status === 401) {
        setError("Sign in to manage your TLDs.");
        setTlds([]);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { tlds?: Tld[]; error?: string };
      if (json.error) setError(json.error);
      setTlds(json.tlds ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your TLDs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Exemptions are per-TLD and only meaningful once an alias is set, so they're
  // fetched lazily rather than up front for every name you hold.
  const loadExempt = useCallback(async (tld: string) => {
    const res = await fetch(`/api/moshpit/tlds/${tld}/exempt`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { labels?: string[]; exempt?: string[] };
    setExempt((prev) => ({ ...prev, [tld]: json.labels ?? json.exempt ?? [] }));
  }, []);

  const run = useCallback(
    async (key: string, fn: () => Promise<Response>, okMessage: string) => {
      setBusy(key);
      setNote(null);
      setError(null);
      try {
        const res = await fn();
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(json.error || `Request failed (${res.status})`);
          return false;
        }
        setNote(okMessage);
        await load();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const register = async () => {
    const tld = claim.trim().replace(/^\./, "");
    if (!tld) return;
    const ok = await run(
      "claim",
      () =>
        fetch("/api/moshpit/tlds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tld }),
        }),
      `Registered .${tld}`,
    );
    if (ok) setClaim("");
  };

  if (loading) return <section className="card2"><h2>Moshpit TLDs</h2><p className="sub">Loading…</p></section>;

  return (
    <section className="card2">
      <h2>Moshpit TLDs</h2>
      <p className="sub">
        The endings you own. Everything under a TLD is yours — claiming <code>.eggs</code> gives you{" "}
        <code>scrambled.eggs</code> without registering it separately.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void register()}
          placeholder=".yourthing"
          aria-label="TLD to claim"
          style={{ flex: 1 }}
        />
        <button onClick={() => void register()} disabled={busy === "claim" || !claim.trim()}>
          {busy === "claim" ? "Claiming…" : "Claim"}
        </button>
      </div>

      {error ? <p className="sub" style={{ color: "#ff6b6b" }}>{error}</p> : null}
      {note ? <p className="sub" style={{ color: "#5ad18c" }}>{note}</p> : null}

      {tlds.length === 0 ? (
        <p className="sub">You don&apos;t hold any TLDs yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {tlds.map((t) => {
            const target = aliasTarget[t.tld] ?? "";
            const labels = exempt[t.tld];
            return (
              <li key={t.tld} style={{ borderTop: "1px solid rgba(255,255,255,.08)", padding: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b>.{t.tld}</b>
                  {t.alias_of ? (
                    <span className="sub">→ points at <b>.{t.alias_of}</b></span>
                  ) : (
                    <span className="sub">stands on its own</span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {t.alias_of ? (
                    <button
                      onClick={() =>
                        void run(
                          `unalias:${t.tld}`,
                          () => fetch(`/api/moshpit/tlds/${t.tld}/alias`, { method: "DELETE" }),
                          `.${t.tld} no longer points anywhere`,
                        )
                      }
                      disabled={busy === `unalias:${t.tld}`}
                    >
                      {busy === `unalias:${t.tld}` ? "Clearing…" : "Clear redirect"}
                    </button>
                  ) : (
                    <>
                      <input
                        value={target}
                        onChange={(e) => setAliasTarget((p) => ({ ...p, [t.tld]: e.target.value }))}
                        placeholder="point at .agent"
                        aria-label={`Redirect .${t.tld} to`}
                      />
                      <button
                        onClick={() =>
                          void run(
                            `alias:${t.tld}`,
                            () =>
                              fetch(`/api/moshpit/tlds/${t.tld}/alias`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ to: target.trim().replace(/^\./, "") }),
                              }),
                            `.${t.tld} now points at .${target.trim().replace(/^\./, "")}`,
                          )
                        }
                        disabled={busy === `alias:${t.tld}` || !target.trim()}
                      >
                        {busy === `alias:${t.tld}` ? "Pointing…" : "Redirect"}
                      </button>
                    </>
                  )}

                  <button onClick={() => void loadExempt(t.tld)}>
                    {labels ? "Refresh held-back names" : "Held-back names"}
                  </button>
                </div>

                {labels ? (
                  <div style={{ marginTop: 8 }}>
                    <p className="sub">
                      Names kept on <b>.{t.tld}</b> even when it redirects
                      {labels.length === 0 ? " — none yet." : ":"}
                    </p>
                    {labels.length > 0 ? (
                      <ul style={{ margin: "4px 0" }}>
                        {labels.map((label) => (
                          <li key={label}>
                            {label}.{t.tld}{" "}
                            <button
                              onClick={() =>
                                void run(
                                  `unexempt:${t.tld}:${label}`,
                                  () =>
                                    fetch(`/api/moshpit/tlds/${t.tld}/exempt`, {
                                      method: "DELETE",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ label }),
                                    }),
                                  `${label}.${t.tld} follows the redirect again`,
                                ).then(() => loadExempt(t.tld))
                              }
                            >
                              release
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={exemptDraft[t.tld] ?? ""}
                        onChange={(e) => setExemptDraft((p) => ({ ...p, [t.tld]: e.target.value }))}
                        placeholder="label to hold back"
                        aria-label={`Hold a name back from .${t.tld}'s redirect`}
                      />
                      <button
                        onClick={() => {
                          const label = (exemptDraft[t.tld] ?? "").trim();
                          if (!label) return;
                          void run(
                            `exempt:${t.tld}`,
                            () =>
                              fetch(`/api/moshpit/tlds/${t.tld}/exempt`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ label }),
                              }),
                            `${label}.${t.tld} will stay put`,
                          ).then(() => {
                            setExemptDraft((p) => ({ ...p, [t.tld]: "" }));
                            return loadExempt(t.tld);
                          });
                        }}
                        disabled={busy === `exempt:${t.tld}`}
                      >
                        Hold back
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
