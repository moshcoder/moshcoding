import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAccountByEmail, setResetToken } from "@/lib/db";
import { authConfigured } from "@/lib/session";
import { isEmailConfigured, sendPasswordReset, appBaseUrl } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Request a password-reset link. Always responds ok — never reveals whether the
// email is registered. When Resend isn't configured (or send fails) the link is
// logged server-side so the flow still works in dev.
export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Accounts are not enabled yet." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body?.email || "").trim().toLowerCase();

  const account = email ? await getAccountByEmail(email) : null;
  if (account) {
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await setResetToken(email, token, expires);
    const link = `${appBaseUrl()}/reset?token=${encodeURIComponent(token)}`;
    if (isEmailConfigured()) {
      const sent = await sendPasswordReset({ email, token });
      if (!sent.ok) console.error("reset email failed — link is:", link, sent.error);
    } else {
      console.log("[reset] email not configured — reset link:", link);
    }
  }
  return NextResponse.json({ ok: true });
}
