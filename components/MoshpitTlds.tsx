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

type PinKind = "tls" | "mtp";

type Pin = {
  tld: string;
  pin: string;
  kind: PinKind;
  note: string | null;
  created_at: string;
};

type PinDraft = {
  kind: PinKind;
  pin: string;
  note: string;
};

const emptyPinDraft = (): PinDraft => ({ kind: "tls", pin: "", note: "" });

const formatCreatedAt = (value: string) => {
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  const date = new Date(sqliteUtc ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const tldRowId = (tld: string) => `moshpit-tld-${tld}`;
const pinPanelId = (tld: string) => `moshpit-pins-${tld}`;

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
  const [pins, setPins] = useState<Partial<Record<string, Pin[]>>>({});
  const [pinDrafts, setPinDrafts] = useState<Partial<Record<string, PinDraft>>>({});

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

  const loadPins = useCallback(async (tld: string) => {
    const key = `pins:load:${tld}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/moshpit/tlds/${tld}/pins`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { pins?: Pin[]; error?: string };
      if (!res.ok) {
        setError(json.error || `Could not load key pins (${res.status})`);
        return;
      }
      setPins((prev) => ({ ...prev, [tld]: json.pins ?? [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load key pins");
    } finally {
      setBusy(null);
    }
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

  const publishPin = async (tld: string) => {
    const draft = pinDrafts[tld] ?? emptyPinDraft();
    const pin = draft.pin.trim();
    if (!pin) return;

    const ok = await run(
      `pin:add:${tld}`,
      () =>
        fetch(`/api/moshpit/tlds/${tld}/pins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, kind: draft.kind, note: draft.note.trim() }),
        }),
      `Published ${draft.kind.toUpperCase()} key for .${tld}`,
    );
    if (!ok) return;

    setPinDrafts((prev) => ({ ...prev, [tld]: emptyPinDraft() }));
    await loadPins(tld);
  };

  const withdrawPin = async (tld: string, entry: Pin) => {
    const confirmed = window.confirm(
      `Withdraw this ${entry.kind.toUpperCase()} key from .${tld}? Connections using it may stop working.`,
    );
    if (!confirmed) return;

    const ok = await run(
      `pin:remove:${tld}:${entry.pin}`,
      () =>
        fetch(`/api/moshpit/tlds/${tld}/pins?pin=${encodeURIComponent(entry.pin)}`, {
          method: "DELETE",
        }),
      `Withdrew ${entry.kind.toUpperCase()} key from .${tld}`,
    );
    if (ok) await loadPins(tld);
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

      {error ? <p className="sub" role="alert" style={{ color: "#ff6b6b" }}>{error}</p> : null}
      {note ? <p className="sub" role="status" aria-live="polite" style={{ color: "#5ad18c" }}>{note}</p> : null}

      {tlds.length === 0 ? (
        <p className="sub">You don&apos;t hold any TLDs yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {tlds.map((t) => {
            const target = aliasTarget[t.tld] ?? "";
            const labels = exempt[t.tld];
            const publishedPins = pins[t.tld];
            const pinDraft = pinDrafts[t.tld] ?? emptyPinDraft();
            return (
              <li
                id={tldRowId(t.tld)}
                key={t.tld}
                style={{ borderTop: "1px solid rgba(255,255,255,.08)", padding: "12px 0", scrollMarginTop: 16 }}
              >
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

                  <button
                    type="button"
                    onClick={() => {
                      if (publishedPins) {
                        setPins((prev) => {
                          const next = { ...prev };
                          delete next[t.tld];
                          return next;
                        });
                      } else {
                        void loadPins(t.tld);
                      }
                    }}
                    disabled={busy === `pins:load:${t.tld}`}
                    aria-expanded={publishedPins !== undefined}
                    aria-controls={pinPanelId(t.tld)}
                  >
                    {busy === `pins:load:${t.tld}`
                      ? "Loading keys…"
                      : publishedPins
                        ? "Hide key pins"
                        : "Key pins"}
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

                {publishedPins ? (
                  <div id={pinPanelId(t.tld)} style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <p className="sub" style={{ margin: 0, flex: 1 }}>
                        {t.alias_of
                          ? `Pins published directly on .${t.tld} protect held-back names only. Names that follow the redirect use .${t.alias_of}'s pins.`
                          : "Publish both old and new keys during rotation, then withdraw the old one after deployment."}
                      </p>
                      {t.alias_of ? (
                        <button
                          type="button"
                          onClick={() => {
                            void loadPins(t.alias_of!);
                            document
                              .getElementById(tldRowId(t.alias_of!))
                              ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          disabled={busy === `pins:load:${t.alias_of}`}
                        >
                          Manage .{t.alias_of} pins
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void loadPins(t.tld)}
                        disabled={busy === `pins:load:${t.tld}`}
                      >
                        Refresh
                      </button>
                    </div>

                    {publishedPins.length === 0 ? (
                      <p className="sub">No TLS or MTP keys published yet.</p>
                    ) : (
                      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
                        {publishedPins.map((entry) => (
                          <li
                            key={entry.pin}
                            style={{
                              borderTop: "1px solid rgba(255,255,255,.08)",
                              padding: "8px 0",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <b>{entry.kind.toUpperCase()}</b>
                              <code style={{ overflowWrap: "anywhere", flex: 1 }}>{entry.pin}</code>
                              <span className="sub">{formatCreatedAt(entry.created_at)}</span>
                              <button
                                type="button"
                                onClick={() => void withdrawPin(t.tld, entry)}
                                disabled={busy === `pin:remove:${t.tld}:${entry.pin}`}
                              >
                                {busy === `pin:remove:${t.tld}:${entry.pin}` ? "Withdrawing…" : "Withdraw"}
                              </button>
                            </div>
                            {entry.note ? <p className="sub" style={{ margin: "4px 0 0" }}>{entry.note}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        value={pinDraft.kind}
                        onChange={(e) =>
                          setPinDrafts((prev) => ({
                            ...prev,
                            [t.tld]: { ...pinDraft, kind: e.target.value as PinKind },
                          }))
                        }
                        aria-label={`Key type for .${t.tld}`}
                      >
                        <option value="tls">TLS</option>
                        <option value="mtp">MTP</option>
                      </select>
                      <input
                        value={pinDraft.pin}
                        onChange={(e) =>
                          setPinDrafts((prev) => ({
                            ...prev,
                            [t.tld]: { ...pinDraft, pin: e.target.value },
                          }))
                        }
                        placeholder="base64 SHA-256 SPKI pin"
                        aria-label={`Key pin for .${t.tld}`}
                        spellCheck={false}
                        style={{ flex: "2 1 280px" }}
                      />
                      <input
                        value={pinDraft.note}
                        onChange={(e) =>
                          setPinDrafts((prev) => ({
                            ...prev,
                            [t.tld]: { ...pinDraft, note: e.target.value },
                          }))
                        }
                        placeholder="note (optional)"
                        aria-label={`Key note for .${t.tld}`}
                        maxLength={200}
                        style={{ flex: "1 1 180px" }}
                      />
                      <button
                        type="button"
                        onClick={() => void publishPin(t.tld)}
                        disabled={busy === `pin:add:${t.tld}` || !pinDraft.pin.trim()}
                      >
                        {busy === `pin:add:${t.tld}`
                          ? "Publishing…"
                          : t.alias_of
                            ? "Publish held-back key"
                            : "Publish key"}
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
