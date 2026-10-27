import type { Metadata } from "next";
import { inviteBonusDays } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "You're invited to moshcoding.com",
  robots: { index: false, follow: false },
};

// /i/<code>: the invite landing. middleware.ts has already stored the code in
// the mc_invite cookie, so signing up (email + password) or signing in with
// CoinPay in this browser accepts it. On another device, paste the code at /invites.
export default async function InviteLanding({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = /^[A-Za-z0-9-]{6,40}$/.test(raw || "") ? raw.toUpperCase() : null;
  const days = inviteBonusDays();
  return (
    <div className="dash">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>You&apos;re invited 🤘</h1>
          <p className="sub">Someone on moshcoding.com wants you in.</p>
        </div>
        <a className="btn2 ghost" href="/">← home</a>
      </div>
      {code ? (
        <section className="card2">
          <p className="sub">
            Create your account and confirm your email: you and the person who invited you each get{" "}
            <b>{days} days of the paid affiliate plan</b> (normally $1/mo), which lets you set your own commission rate.
          </p>
          <ul className="list">
            <li><span>Invite code</span><span className="muted">{code}</span></li>
          </ul>
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn2" href="/signup">Claim your page, free</a>
            <a className="btn2 ghost" href="/auth/login">Sign in with CoinPay</a>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            Already signed in, or on another device? Paste the code at <a href={`/invites?code=${encodeURIComponent(code)}`}>/invites</a>.
            Invites are for new accounts, one per account.
          </p>
        </section>
      ) : (
        <section className="card2"><p className="sub">That invite link is not right. Ask for a fresh one.</p></section>
      )}
    </div>
  );
}
