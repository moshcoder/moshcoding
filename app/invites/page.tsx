"use client";
import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

type Invite = { id: string; note: string; created_at: string | null; expires_at: string | null; used: boolean; used_at: string | null; revoked: boolean };
type InvitesData = {
  quota: { total: number; used: number; left: number };
  bonus_days: number;
  can_send: boolean;
  send_error: string | null;
  my_bonus: { status: string; reason: string | null } | null;
  invites: Invite[];
};
type Plan = { plan: "paid" | "free"; paid_until: string | null };

const INVITE_NOTES: Record<string, { t: string; ok: boolean }> = {
  pending: { t: "Invite accepted. Check your email and confirm your address to unlock the bonus.", ok: true },
  denied: { t: "Invite accepted. This sign-up does not qualify for the bonus.", ok: true },
  invalid: { t: "That invite code is not valid.", ok: false },
  expired: { t: "That invite has expired.", ok: false },
  used: { t: "That invite was already used.", ok: false },
  self: { t: "You cannot use your own invite.", ok: false },
  revoked: { t: "That invite was withdrawn.", ok: false },
  already_invited: { t: "Your account has already accepted an invite.", ok: false },
  too_old: { t: "Invites are for new accounts.", ok: false },
  no_account: { t: "Sign in with your email and password to use an invite on this account.", ok: false },
};
const CONFIRM_ERRORS: Record<string, string> = {
  bad_link: "That confirm link is not valid or has expired. Send a fresh one below.",
  email_changed: "That link was for a different address.",
  nothing_pending: "Nothing left to confirm: the bonus was already paid.",
};

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export default function InvitesPage() {
  const [me, setMe] = useState<any>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [data, setData] = useState<InvitesData | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([api("/api/credits"), api("/api/invites")]);
    setPlan(p);
    setData(d);
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("code")) setInviteCode(sp.get("code")!);
    const inv = sp.get("invite");
    if (inv && INVITE_NOTES[inv]) setMsg(INVITE_NOTES[inv]);
    if (sp.get("confirmed")) setMsg({ t: `Email confirmed: ${sp.get("confirmed")} days of the paid plan added. 🤘`, ok: true });
    const ce = sp.get("confirm_error");
    if (ce) setMsg({ t: CONFIRM_ERRORS[ce] || "That confirm link did not work.", ok: false });
    fetch("/api/me").then((r) => r.json()).then((m) => {
      setMe(m);
      if (m?.user) load().catch((e) => setMsg({ t: e.message, ok: false }));
    }).catch(() => setMe(null));
  }, [load]);

  const run = (fn: () => Promise<void>) => async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try { await fn(); } catch (err: any) { setMsg({ t: err.message || "Failed.", ok: false }); }
    finally { setBusy(false); }
  };

  const redeem = run(async () => {
    const r = await api("/api/credits", "POST", { code });
    setCode("");
    setMsg({ t: `Code redeemed: ${r.days} days of the paid plan added. 🤘`, ok: true });
    await load();
  });
  const accept = run(async () => {
    const r = await api("/api/invites/accept", "POST", { code: inviteCode });
    setInviteCode("");
    setMsg({ t: r.message, ok: true });
    await load();
  });
  const create = run(async () => {
    const r = await api("/api/invites", "POST", { note });
    setNote("");
    setFresh(r.link);
    await load();
  });
  const resend = run(async () => {
    await api("/api/invites/resend", "POST", {});
    setMsg({ t: "Sent. Check your email for the confirm link.", ok: true });
  });

  if (me === undefined) return <div className="dash"><p className="sub">Loading…</p></div>;
  if (!me?.user) {
    return (
      <div className="dash">
        <h1>Invites &amp; codes</h1>
        {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}
        <p className="sub">Sign in to redeem a code or hand out invites.</p>
        <div className="row">
          <a className="btn2" href="/login">Log in</a>
          <a className="btn2 ghost" href="/signup">Claim your page, free</a>
        </div>
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>Invites &amp; codes</h1><p className="sub">{me.user.email}</p></div>
        <a className="btn2 ghost" href="/dashboard/affiliates">← dashboard</a>
      </div>
      {msg && <p className={`dash-msg ${msg.ok ? "ok" : "err"}`}>{msg.t}</p>}

      <section className="card2" id="redeem">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Have a code?</h2>
          {plan && <span className="pill">{plan.plan === "paid" ? `paid plan${plan.paid_until ? ` · until ${day(plan.paid_until)}` : ""}` : "free plan"}</span>}
        </div>
        <p className="sub">A credit code adds days of the paid affiliate plan ($1/mo): set your own commission rate instead of the 80% floor.</p>
        <form className="row" onSubmit={redeem}>
          <input className="inp" placeholder="MOSH-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <button className="btn2" type="submit" disabled={busy || !code.trim()}>Redeem</button>
        </form>
      </section>

      <section className="card2">
        <h2>Have an invite code?</h2>
        <p className="sub">New accounts (under a week old) can accept one invite. Confirm your email and you both get {data?.bonus_days ?? 30} days of the paid plan.</p>
        {data?.my_bonus?.status === "pending" ? (
          <div className="row">
            <span className="muted">Invite accepted: confirm your email to unlock the bonus.</span>
            <button className="btn2 ghost" disabled={busy} onClick={() => resend()}>Resend the link</button>
          </div>
        ) : data?.my_bonus ? (
          <p className="muted">You joined with an invite{data.my_bonus.status === "paid" ? " and the bonus was paid." : "."}</p>
        ) : (
          <form className="row" onSubmit={accept}>
            <input className="inp" placeholder="INV-XXXX-XXXX-XXXX" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" />
            <button className="btn2" type="submit" disabled={busy || !inviteCode.trim()}>Accept</button>
          </form>
        )}
      </section>

      <section className="card2">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Your invites</h2>
          {data && <span className="pill">{data.quota.left} of {data.quota.total} left</span>}
        </div>
        <p className="sub">Invites are scarce on purpose: each one works once and expires in 30 days. When someone you invite confirms their email, you both get {data?.bonus_days ?? 30} days of the paid plan.</p>
        {data && !data.can_send ? (
          <p className="muted">{data.send_error}</p>
        ) : data && data.quota.left > 0 ? (
          <form className="row" onSubmit={create}>
            <input className="inp" placeholder="who is it for? (optional)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
            <button className="btn2" type="submit" disabled={busy}>Create invite</button>
          </form>
        ) : data ? (
          <p className="muted">No invites left.</p>
        ) : null}
        {fresh && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="inp" readOnly value={fresh} />
            <button className="btn2 ghost" type="button" onClick={() => copyText(fresh).then((ok) => setMsg({ t: ok ? "Copied. 🤘" : "Select the link and copy it.", ok }))}>Copy</button>
          </div>
        )}
        {fresh && <p className="sub">Shown once. Only a hash of the code is stored.</p>}
        <ul className="list">
          {(data?.invites || []).map((i) => (
            <li key={i.id}>
              <span>{i.note || "invite"} <span className="muted">· {day(i.created_at)}</span></span>
              <span className="muted">{i.used ? `used ${day(i.used_at)}` : i.revoked ? "withdrawn" : i.expires_at && Date.parse(i.expires_at) < Date.now() ? "expired" : `open until ${day(i.expires_at)}`}</span>
            </li>
          ))}
          {data && !data.invites.length && <li className="muted">No invites yet.</li>}
        </ul>
        <p className="sub" style={{ marginTop: 8 }}>Looking for your open referral link? It is on the <a href="/dashboard/affiliates">Affiliates</a> tab.</p>
      </section>
    </div>
  );
}
