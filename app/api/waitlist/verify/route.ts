import { NextRequest, NextResponse } from "next/server";
import { verifySignup } from "@/lib/db";
import { appBaseUrl } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-click confirmation target for the Resend verification email. Marks the
// signup verified and shows a small branded thank-you page.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  let ok = false;
  try {
    ok = Boolean(await verifySignup(token));
  } catch (err: any) {
    console.error("waitlist verify failed:", err?.message);
  }

  const home = appBaseUrl();
  const title = ok ? "You're in the pit. 🤘" : "Link expired or already used";
  const body = ok
    ? "Your email is confirmed. We'll hit you up the moment it drops."
    : "This confirmation link is invalid, expired, or already used. Re-join the waitlist to get a fresh one.";
  const accent = ok ? "#9EF01A" : "#ff5555";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <main style="max-width:440px;padding:32px;text-align:center">
    <h1 style="font-size:24px;color:${accent};margin:0 0 12px">${title}</h1>
    <p style="line-height:1.6;color:#c9c9c9;margin:0 0 24px">${body}</p>
    <a href="${home}" style="display:inline-block;background:${accent};color:#0b0b0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Back to moshcoding</a>
  </main>
</body></html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
