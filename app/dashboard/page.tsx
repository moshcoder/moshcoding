"use client";
import { useEffect, useState, useCallback } from "react";
import { copyText } from "@/lib/clipboard";

type Org = { id: string; name: string };
type Team = { id: string; name: string; org_id: string; org_name: string; role: string };
type Project = { id: string; name: string; team_id: string; team_name: string };

async function api(path: string, method = "GET", body?: any) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function Dashboard() {
  const [me, setMe] = useState<any>(undefined);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const [orgName, setOrgName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamOrg, setTeamOrg] = useState("");
  const [projName, setProjName] = useState("");
  const [projTeam, setProjTeam] = useState("");
  const [tab, setTab] = useState<"page" | "waitlist" | "auctions" | "affiliates">("page");

  const say = (t: string, ok = true) => setMsg({ t, ok });

  const refresh = useCallback(async () => {
    const [o, t, p] = await Promise.all([api("/api/orgs"), api("/api/teams"), api("/api/projects")]);
    setOrgs(o.orgs); setTeams(t.teams); setProjects(p.projects);
    if (o.orgs[0] && !teamOrg) setTeamOrg(o.orgs[0].id);
    if (t.teams[0] && !projTeam) setProjTeam(t.teams[0].id);
  }, [teamOrg, projTeam]);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((m) => {
      setMe(m);
      if (m.user) refresh().catch((e) => say(e.message, false));
    });
  }, [refresh]);

  const wrap = (fn: () => Promise<any>) => async () => {
    try { await fn(); await refresh(); } catch (e: any) { say(e.message, false); }
  };

  if (me === undefined) return <div className="dash"><p className="sub">Loading…</p></div>;
  if (!me?.user) {
    return (
      <div className="dash">
        <h1>Dashboard</h1>
        <p className="sub">Sign in to manage your page, socials &amp; payout wallet.</p>
        <div className="row">
          <a className="btn2" href="/login">Log in</a>
          <a className="btn2 ghost" href="/signup">Claim your page — free</a>
        </div>
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Dashboard</h1><p className="sub">{me.user.email}</p></div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>
      {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}

      <div className="tabs">
        <button className={`tab${tab === "page" ? " on" : ""}`} onClick={() => setTab("page")}>My page &amp; teams</button>
        <button className={`tab${tab === "waitlist" ? " on" : ""}`} onClick={() => setTab("waitlist")}>Waitlist</button>
        <button className={`tab${tab === "auctions" ? " on" : ""}`} onClick={() => setTab("auctions")}>Auctions</button>
        <button className={`tab${tab === "affiliates" ? " on" : ""}`} onClick={() => setTab("affiliates")}>Affiliates</button>
      </div>

      {tab === "affiliates" ? (
        <AffiliatesPanel onError={(m) => say(m, false)} onOk={(m) => say(m, true)} />
      ) : tab === "auctions" ? (
        <AuctionsPanel onError={(m) => say(m, false)} onOk={(m) => say(m, true)} />
      ) : tab === "waitlist" ? (
        <WaitlistPanel onError={(m) => say(m, false)} />
      ) : (
      <>
      <AccountPanel onError={(m) => say(m, false)} onOk={(m) => say(m, true)} />

      <section className="card2">
        <h2>Organizations</h2>
        <div className="row">
          <input className="inp" placeholder="New org name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <button className="btn2" disabled={!orgName.trim()} onClick={wrap(async () => { await api("/api/orgs", "POST", { name: orgName.trim() }); setOrgName(""); say("Org created."); })}>Create org</button>
        </div>
        <ul className="list">{orgs.map((o) => <li key={o.id}><span>{o.name}</span><span className="muted">{o.id.slice(0, 8)}</span></li>)}</ul>
      </section>

      <section className="card2">
        <h2>Teams</h2>
        <div className="row">
          <input className="inp" placeholder="New team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <select className="inp sel" value={teamOrg} onChange={(e) => setTeamOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn2" disabled={!teamName.trim() || !teamOrg} onClick={wrap(async () => { await api("/api/teams", "POST", { name: teamName.trim(), org_id: teamOrg }); setTeamName(""); say("Team created."); })}>Create team</button>
        </div>
        <ul className="list">{teams.map((t) => (
          <li key={t.id}><span>{t.name} <span className="muted">· {t.org_name}</span></span><span className="pill">{t.role}</span></li>
        ))}</ul>
      </section>

      <section className="card2">
        <h2>Projects</h2>
        <div className="row">
          <input className="inp" placeholder="New project name" value={projName} onChange={(e) => setProjName(e.target.value)} />
          <select className="inp sel" value={projTeam} onChange={(e) => setProjTeam(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn2" disabled={!projName.trim() || !projTeam} onClick={wrap(async () => { await api("/api/projects", "POST", { name: projName.trim(), team_id: projTeam }); setProjName(""); say("Project created."); })}>Create project</button>
        </div>
        <ul className="list">{projects.map((p) => <li key={p.id}><span>{p.name} <span className="muted">· {p.team_name}</span></span></li>)}</ul>
      </section>

      {projects.map((p) => <ProjectWebhooks key={p.id} project={p} onError={(m) => say(m, false)} />)}

      <section className="card2">
        <h2>Invite a teammate</h2>
        <InviteForm teams={teams} onDone={(m, ok) => say(m, ok)} />
      </section>
      </>
      )}
    </div>
  );
}

type LinkRow = { label: string; url: string };
type AccountView = {
  email: string;
  domain: string | null;
  payout_wallet: string | null;
  plan: string;
  status: string;
  config: any;
  pageUrl: string | null;
  payUrl: string | null;
};

const PLATFORMS: [string, string, string][] = [
  ["x", "X / Twitter", "@handle"],
  ["bluesky", "Bluesky", "@you.bsky.social"],
  ["instagram", "Instagram", "@handle"],
  ["tiktok", "TikTok", "@handle"],
  ["github", "GitHub", "username"],
  ["youtube", "YouTube", "@channel"],
];

function LinkEditor({ title, rows, setRows }: { title: string; rows: LinkRow[]; setRows: (r: LinkRow[]) => void }) {
  const set = (i: number, k: keyof LinkRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <h3 className="ed-h">{title}</h3>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input className="inp" style={{ flex: "0 0 34%" }} placeholder="Label" value={r.label} onChange={(e) => set(i, "label", e.target.value)} />
          <input className="inp" placeholder="https://…" value={r.url} onChange={(e) => set(i, "url", e.target.value)} />
          <button className="btn2 ghost" type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn2 ghost" type="button" onClick={() => setRows([...rows, { label: "", url: "" }])}>+ add</button>
    </div>
  );
}

function AccountPanel({ onError, onOk }: { onError: (m: string) => void; onOk: (m: string) => void }) {
  const [acct, setAcct] = useState<AccountView | null | undefined>(undefined);
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [sponsors, setSponsors] = useState<LinkRow[]>([]);
  const [hashtags, setHashtags] = useState("");
  const [stream, setStream] = useState("");
  const [fgRgba, setFgRgba] = useState("");
  const [bgRgba, setBgRgba] = useState("");
  const [text, setText] = useState<Record<string, string>>({ brand: "", headline: "", tagline: "", sub: "" });
  const [wallet, setWallet] = useState("");
  const [domain, setDomain] = useState("");
  const [repo, setRepo] = useState("");
  const [assetPattern, setAssetPattern] = useState("");
  const [assets, setAssets] = useState<{ label: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const hydrate = (a: AccountView) => {
    const c = a.config || {};
    setDomain(a.domain || "");
    setRepo(c.repo || "");
    setAssetPattern(c.assetPattern || "");
    setAssets(c.assets || []);
    setSocials(c.socials || {});
    setLinks(c.customLinks || []);
    setSponsors(c.sponsors || []);
    setHashtags((c.hashtags || []).join(", "));
    setStream(c.stream || "");
    setFgRgba(c.fgRgba || "");
    setBgRgba(c.bgRgba || "");
    setText({ brand: c.brand || "", headline: c.headline || "", tagline: c.tagline || "", sub: c.sub || "" });
    setWallet(a.payout_wallet || "");
  };

  useEffect(() => {
    fetch("/api/account").then((r) => r.json()).then((d) => {
      setAcct(d.account);
      if (d.account) hydrate(d.account);
    }).catch(() => setAcct(null));
  }, []);

  if (acct === undefined || acct === null) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          payoutWallet: wallet.trim(),
          config: {
            socials,
            customLinks: links.filter((l) => l.url.trim()),
            sponsors: sponsors.filter((l) => l.url.trim()),
            hashtags,
            stream: stream.trim(),
            fgRgba: fgRgba.trim(),
            bgRgba: bgRgba.trim(),
            repo: repo.trim(),
            assetPattern: assetPattern.trim(),
            ...text,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAcct(data.account);
      hydrate(data.account);
      if (data.warning) onError(data.warning);
      else onOk(acct.status === "active" ? "Saved & published to your page. 🤘" : "Saved.");
    } catch (e: any) { onError(e.message || "Couldn't save."); }
    finally { setSaving(false); }
  };

  return (
    <section className="card2">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Your page — edit</h2>
        <span className="pill">{acct.status === "active" ? `${acct.plan} · live` : "setup pending"}</span>
      </div>

      {acct.status === "pending" && (
        <p className="dash-msg err" style={{ marginTop: 0 }}>
          Your account isn't active yet.{" "}
          {acct.payUrl ? <a href={acct.payUrl}>Finish checkout →</a> : null}
        </p>
      )}

      <h3 className="ed-h">Domain</h3>
      <div className="row">
        <input className="inp" placeholder="your-domain.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        {acct.pageUrl && <a className="btn2 ghost" href={acct.pageUrl} target="_blank" rel="noopener noreferrer">View ↗</a>}
      </div>

      <h3 className="ed-h">Copy <span className="muted">(optional — defaults are auto-generated)</span></h3>
      <div className="row"><input className="inp" placeholder="Brand name" value={text.brand} onChange={(e) => setText({ ...text, brand: e.target.value })} /></div>
      <div className="row"><input className="inp" placeholder="Headline (e.g. IS COMING)" value={text.headline} onChange={(e) => setText({ ...text, headline: e.target.value })} /></div>
      <div className="row"><input className="inp" placeholder="Tagline" value={text.tagline} onChange={(e) => setText({ ...text, tagline: e.target.value })} /></div>
      <div className="row"><input className="inp" placeholder="Sub-text" value={text.sub} onChange={(e) => setText({ ...text, sub: e.target.value })} /></div>

      <h3 className="ed-h">Socials</h3>
      {PLATFORMS.map(([k, label, ph]) => (
        <div className="row" key={k}>
          <span className="muted" style={{ width: 92, flex: "0 0 92px" }}>{label}</span>
          <input className="inp" placeholder={ph} value={socials[k] || ""} onChange={(e) => setSocials({ ...socials, [k]: e.target.value })} />
        </div>
      ))}

      <LinkEditor title="Links" rows={links} setRows={setLinks} />
      <LinkEditor title="Sponsors" rows={sponsors} setRows={setSponsors} />

      <h3 className="ed-h">Hashtags <span className="muted">(comma-separated keywords)</span></h3>
      <div className="row"><input className="inp" placeholder="moshcoding, launch" value={hashtags} onChange={(e) => setHashtags(e.target.value)} /></div>

      <h3 className="ed-h">Stream URL</h3>
      <div className="row"><input className="inp" placeholder="https://open.spotify.com/playlist/…" value={stream} onChange={(e) => setStream(e.target.value)} /></div>

      <h3 className="ed-h">Accent colors <span className="muted">(rgba() or bare 255,0,80,1)</span></h3>
      <div className="row">
        <input className="inp" placeholder="foreground (fg_rgba)" value={fgRgba} onChange={(e) => setFgRgba(e.target.value)} />
        <input className="inp" placeholder="background (bg_rgba)" value={bgRgba} onChange={(e) => setBgRgba(e.target.value)} />
      </div>

      <h3 className="ed-h">GitHub assets <span className="muted">(pull images from a repo onto your page)</span></h3>
      <div className="row"><input className="inp" placeholder="owner/repo — e.g. moshcoder/moshcoding" value={repo} onChange={(e) => setRepo(e.target.value)} /></div>
      <div className="row"><input className="inp" placeholder="path glob — e.g. images/*_thumb.png" value={assetPattern} onChange={(e) => setAssetPattern(e.target.value)} /></div>
      {assets.length > 0 && (
        <div className="t-assets" style={{ margin: "10px 0 0" }}>
          {assets.slice(0, 12).map((a, i) => <span key={i} className="t-asset"><img src={a.url} alt={a.label} loading="lazy" /></span>)}
        </div>
      )}
      {repo && <p className="sub" style={{ marginTop: 6 }}>{assets.length} asset(s) loaded. Public repos work as-is; private repos need a server GITHUB_TOKEN.</p>}

      <h3 className="ed-h">CoinPay payout wallet</h3>
      <div className="row"><input className="inp" placeholder="wallet address" value={wallet} onChange={(e) => setWallet(e.target.value)} /></div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn2" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save & publish"}</button>
        {acct.pageUrl && <a className="btn2 ghost" href={acct.pageUrl} target="_blank" rel="noopener noreferrer">Preview ↗</a>}
      </div>
    </section>
  );
}

function WaitlistPanel({ onError }: { onError: (m: string) => void }) {
  const [domains, setDomains] = useState<any[] | undefined>(undefined);
  const [active, setActive] = useState<string | null>(null);
  const [signups, setSignups] = useState<any[] | null>(null);

  const load = async (dn: string) => {
    setActive(dn); setSignups(null);
    try {
      const r = await fetch(`/api/waitlist/manage?dn=${encodeURIComponent(dn)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSignups(d.signups || []);
    } catch (e: any) { onError(e.message || "Failed to load."); setSignups([]); }
  };

  useEffect(() => {
    fetch("/api/account").then((r) => r.json()).then((d) => {
      setDomains(d.parkedDomains || []);
      if (d.parkedDomains?.[0]) load(d.parkedDomains[0].domain);
    }).catch(() => setDomains([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (domains === undefined) return <section className="card2"><p className="sub">Loading…</p></section>;
  if (!domains.length) {
    return <section className="card2"><h2>Waitlist</h2><p className="sub">No parked domains yet — claim one on the “My page &amp; teams” tab and its waitlist shows up here.</p></section>;
  }

  return (
    <section className="card2">
      <h2>Waitlist</h2>
      <p className="sub">Each parked domain keeps its own waitlist.</p>
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {domains.map((d) => (
          <button key={d.domain} className={`tab${active === d.domain ? " on" : ""}`} onClick={() => load(d.domain)}>
            {d.domain} <span className="muted">({d.count})</span>
          </button>
        ))}
      </div>
      {active && (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="ed-h">{active} — {signups ? signups.length : "…"} signups</h3>
            <a className="btn2 ghost" href={`/api/waitlist/manage?dn=${encodeURIComponent(active)}&format=csv`}>Export CSV</a>
          </div>
          <ul className="list">
            {signups === null && <li className="muted">Loading…</li>}
            {signups && signups.length === 0 && <li className="muted">No signups yet — share your page.</li>}
            {signups && signups.map((s, i) => (
              <li key={i}>
                <span>{s.email}</span>
                <span className="muted">{s.verified ? "✓ confirmed" : "pending"}{s.ref ? ` · ref:${s.ref}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AuctionsPanel({ onError, onOk }: { onError: (m: string) => void; onOk: (m: string) => void }) {
  const [domains, setDomains] = useState<any[] | undefined>(undefined);
  const [active, setActive] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [reserve, setReserve] = useState("");
  const [buyNow, setBuyNow] = useState("");
  const [busy, setBusy] = useState(false);

  const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const load = async (dn: string) => {
    setActive(dn); setData(null);
    try {
      const r = await fetch(`/api/auctions?dn=${encodeURIComponent(dn)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setReserve(d.reserveCents != null ? String(d.reserveCents / 100) : "");
      setBuyNow(d.buyNowCents != null ? String(d.buyNowCents / 100) : "");
    } catch (e: any) { onError(e.message || "Failed to load."); setData({ bids: [] }); }
  };

  useEffect(() => {
    fetch("/api/account").then((r) => r.json()).then((d) => {
      setDomains(d.parkedDomains || []);
      if (d.parkedDomains?.[0]) load(d.parkedDomains[0].domain);
    }).catch(() => setDomains([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auctions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dn: active, reserve, buyNow }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onOk("Auction saved."); await load(active);
    } catch (e: any) { onError(e.message || "Save failed."); } finally { setBusy(false); }
  };

  const accept = async (bidId: string, email: string) => {
    if (!active || !confirm(`Accept the bid from ${email}? This closes the auction.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auctions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dn: active, action: "accept", bidId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onOk("Bid accepted — auction closed."); await load(active);
    } catch (e: any) { onError(e.message || "Accept failed."); } finally { setBusy(false); }
  };

  if (domains === undefined) return <section className="card2"><p className="sub">Loading…</p></section>;
  if (!domains.length) {
    return <section className="card2"><h2>Auctions</h2><p className="sub">No parked domains yet — claim one on the “My page &amp; teams” tab, then set a reserve/buy-now and collect bids here.</p></section>;
  }

  const closed = data?.status === "closed";
  return (
    <section className="card2">
      <h2>Auctions</h2>
      <p className="sub">Each parked domain collects bids forever, until you accept one. Reserve is hidden from bidders; a bid at or above buy-now wins instantly.</p>
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {domains.map((d) => (
          <button key={d.domain} className={`tab${active === d.domain ? " on" : ""}`} onClick={() => load(d.domain)}>
            {d.domain}
          </button>
        ))}
      </div>
      {active && data && (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="ed-h">{active} {closed ? "— closed 🔒" : ""}</h3>
            <a className="btn2 ghost" href={`/?bid=${encodeURIComponent(active)}`} target="_blank" rel="noopener noreferrer">View bid page ↗</a>
          </div>

          <div className="ed-grid">
            <label>Reserve price (USD)
              <input type="number" min="0" step="1" placeholder="hidden from bidders" value={reserve} onChange={(e) => setReserve(e.target.value)} disabled={closed} />
            </label>
            <label>Buy-it-now price (USD)
              <input type="number" min="0" step="1" placeholder="optional instant win" value={buyNow} onChange={(e) => setBuyNow(e.target.value)} disabled={closed} />
            </label>
          </div>
          {!closed && <button className="btn2" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save auction"}</button>}

          <h3 className="ed-h" style={{ marginTop: 18 }}>Bids ({data.bids?.length || 0})</h3>
          <ul className="list">
            {(!data.bids || data.bids.length === 0) && <li className="muted">No bids yet — share the bid page.</li>}
            {data.bids?.map((b: any) => (
              <li key={b.id}>
                <span><b>{money(b.amount_cents)}</b> — {b.bidder_email}{b.message ? <span className="muted"> · “{b.message}”</span> : null}</span>
                <span>
                  {b.status === "accepted" ? <span className="muted">✓ accepted</span>
                    : b.status === "rejected" ? <span className="muted">passed</span>
                    : closed ? null
                    : <button className="btn2 ghost" onClick={() => accept(b.id, b.bidder_email)} disabled={busy}>Accept</button>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AffiliatesPanel({ onError, onOk }: { onError: (m: string) => void; onOk: (m: string) => void }) {
  const [data, setData] = useState<any>(undefined);
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/affiliate").then((r) => r.json()).then((d) => {
      setData(d);
      if (d.affiliate) setPct(String(d.affiliate.commission_pct));
    }).catch(() => setData({ affiliate: null, floor: 80 }));
  useEffect(() => { load(); }, []);

  if (data === undefined) return <section className="card2"><p className="sub">Loading…</p></section>;
  const aff = data.affiliate;
  const copy = (t: string) => copyText(t).then((ok) => onOk(ok ? "Copied. 🤘" : "Couldn't copy — select the text and copy manually."));

  const post = async (body: any, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/affiliate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      if (d.affiliate) setPct(String(d.affiliate.commission_pct));
      onOk(okMsg);
    } catch (e: any) { onError(e.message || "Failed."); }
    finally { setBusy(false); }
  };

  if (!aff) {
    return (
      <section className="card2">
        <h2>Affiliates</h2>
        <p className="sub">
          Earn <b>up to 80% commission</b> on all fees from people you refer. The free plan is floored at
          80% minimum payout; upgrade to <b>$1/mo</b> to set your own rate. Clicks are tracked with a
          <b> 90-day cookie</b> — you're credited if they sign up within 90 days.
        </p>
        <button className="btn2" disabled={busy} onClick={() => post({}, "You're an affiliate. 🤘")}>
          {busy ? "…" : "Become an 80% affiliate"}
        </button>
        <p className="sub" style={{ marginTop: 8 }}>Requires a claimed page. <a href="/signup">Claim yours — free</a>.</p>
      </section>
    );
  }

  return (
    <section className="card2">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Affiliates</h2>
        <span className="pill">{aff.plan === "paid" ? "paid · custom rate" : `free · ${aff.commission_pct}% floor`}</span>
      </div>
      <ul className="list">
        <li><span>Your code</span><span className="muted">{aff.code}</span></li>
        <li><span>Commission</span><span className="muted">{aff.commission_pct}%</span></li>
      </ul>

      <h3 className="ed-h">Share links</h3>
      <div className="row"><input className="inp" readOnly value={aff.shareUrl} /><button className="btn2 ghost" onClick={() => copy(aff.shareUrl)}>Copy</button></div>
      <div className="row"><input className="inp" readOnly value={aff.refUrl} /><button className="btn2 ghost" onClick={() => copy(aff.refUrl)}>Copy</button></div>
      <p className="sub" style={{ marginTop: 8 }}>🍪 Any visit to one of these links drops a <b>90-day first-touch cookie</b> — you get credit if they sign up within 90 days, even later.</p>

      <h3 className="ed-h">Commission rate</h3>
      {aff.plan === "paid" ? (
        <div className="row">
          <input className="inp" type="number" min={1} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
          <button className="btn2" disabled={busy} onClick={() => post({ action: "setCommission", commission_pct: Number(pct) }, "Commission updated.")}>Save</button>
        </div>
      ) : (
        <p className="sub">Locked at the {data.floor}% floor on the free plan. <b>Upgrade to $1/mo</b> to lower it. <span className="muted">(recurring billing coming soon)</span></p>
      )}

      <h3 className="ed-h">Referred users ({data.referrals?.length || 0})</h3>
      <ul className="list">
        {(data.referrals || []).map((r: any, i: number) => (
          <li key={i}><span>{r.domain || r.email}</span><span className="muted">{r.status}</span></li>
        ))}
        {(!data.referrals || !data.referrals.length) && <li className="muted">No referrals yet — share your link.</li>}
      </ul>
    </section>
  );
}

function ProjectWebhooks({ project, onError }: { project: Project; onError: (m: string) => void }) {
  const [out, setOut] = useState<any[]>([]);
  const [inb, setInb] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/projects/${project.id}/webhooks`).then((r) => r.json()),
        fetch(`/api/projects/${project.id}/inbound-webhooks`).then((r) => r.json()),
      ]);
      setOut(a.endpoints || []); setInb(b.receivers || []);
    } catch { /* ignore */ }
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body: any, label: string) => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.secret) setSecret(`${label} secret (shown once): ${data.secret}`);
      await load();
    } catch (e: any) { onError(e.message); }
  };

  return (
    <section className="card2">
      <h2>Webhooks — {project.name}</h2>
      <div className="row">
        <input className="inp" placeholder="https://your-endpoint.com/hook" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn2" disabled={!url.trim()} onClick={() => { post(`/api/projects/${project.id}/webhooks`, { url: url.trim() }, "Outbound"); setUrl(""); }}>Add outbound</button>
        <button className="btn2 ghost" onClick={() => post(`/api/projects/${project.id}/webhooks/test`, {}, "").then(() => onError("Test event dispatched."))}>Send test</button>
      </div>
      <ul className="list">{out.map((e) => <li key={e.id}><span>↗ {e.url}</span><span className="muted">{JSON.parse(e.events).join(", ")}</span></li>)}
        {out.length === 0 && <li className="muted">No outbound endpoints yet.</li>}</ul>
      <div className="row" style={{ marginTop: 14 }}>
        <input className="inp" placeholder="inbound provider (e.g. github)" value={provider} onChange={(e) => setProvider(e.target.value)} />
        <button className="btn2" disabled={!provider.trim()} onClick={() => { post(`/api/projects/${project.id}/inbound-webhooks`, { provider: provider.trim() }, "Inbound"); setProvider(""); }}>Add inbound</button>
      </div>
      <ul className="list">{inb.map((e) => <li key={e.id}><span>↘ {e.provider}</span><span className="muted">{e.url}</span></li>)}
        {inb.length === 0 && <li className="muted">No inbound receivers yet.</li>}</ul>
      {secret && <p className="secret">{secret}</p>}
    </section>
  );
}

function InviteForm({ teams, onDone }: { teams: Team[]; onDone: (m: string, ok: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("member");
  useEffect(() => { if (teams[0] && !team) setTeam(teams[0].id); }, [teams, team]);
  return (
    <div className="row">
      <input className="inp" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <select className="inp sel" value={team} onChange={(e) => setTeam(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select className="inp sel" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option>
      </select>
      <button className="btn2" disabled={!email.trim() || !team} onClick={async () => {
        try {
          const res = await fetch(`/api/teams/${team}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), role }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          onDone(`Invite sent — token: ${data.invitation.token.slice(0, 12)}…`, true);
          setEmail("");
        } catch (e: any) { onDone(e.message, false); }
      }}>Invite</button>
    </div>
  );
}
