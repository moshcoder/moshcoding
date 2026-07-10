"use client";
import { useEffect, useState, useCallback } from "react";

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
        <p className="sub">Sign in to manage orgs, teams, projects &amp; webhooks.</p>
        <a className="btn2" href="/auth/login">Log in with CoinPay</a>
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
    </div>
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
