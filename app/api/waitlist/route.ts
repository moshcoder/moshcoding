import { NextRequest, NextResponse } from "next/server";
import { addSignup, verifySignup } from "@/lib/db";
import { safeDomain } from "@/lib/config";
import { isEmailConfigured, sendWaitlistVerification } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Referral code from ?ref=<code>: keep it URL-safe and bounded, or drop it. */
function cleanRef(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const safe = s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return safe || null;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body?.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
  }
  const dn = body?.dn ? safeDomain(body.dn) : null;
  if (body?.dn && !dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  const domain = dn || "moshcoding.com";
  const ref = cleanRef(body?.ref);

  try {
    const result = await addSignup({ email, dn: domain, ua: req.headers.get("user-agent"), ref });

    // Already confirmed — nothing to send.
    if (result.verified) {
      return NextResponse.json({ ok: true, already: true, verified: true, pending: false });
    }

    // Double opt-in: e-mail a confirmation link via Resend. If Resend isn't
    // configured (local dev / self-host), auto-confirm so the flow still works.
    if (result.token && isEmailConfigured()) {
      const sent = await sendWaitlistVerification({ email, token: result.token });
      if (!sent.ok) {
        // Never block a signup because email is misconfigured (bad key, unverified
        // domain, Resend down). Save them and auto-confirm; log loudly so the
        // real problem is visible in the deploy logs.
        console.error("waitlist verification email failed — auto-confirming instead:", sent.error);
        if (result.token) await verifySignup(result.token);
        return NextResponse.json({ ok: true, already: result.already, pending: false, emailFailed: true });
      }
      return NextResponse.json({ ok: true, already: result.already, pending: true });
    }

    if (result.token) await verifySignup(result.token);
    return NextResponse.json({ ok: true, already: result.already, pending: false });
  } catch (err: any) {
    console.error("waitlist insert failed:", err?.message);
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }
}
