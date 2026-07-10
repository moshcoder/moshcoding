import { NextRequest, NextResponse } from "next/server";
import { verifySignup, getTenantConfig } from "@/lib/db";
import { configFor, safeDomain } from "@/lib/config";
import { appBaseUrl } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[<>"'&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c] as string));

// One-click confirmation target for the Resend verification email. Marks the
// signup verified, then bounces the visitor BACK to the domain they signed up
// on (e.g. moshcode.sh) — not moshcoding.com. The signup row carries its dn.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  let dn: string | null = null;
  try {
    const result = await verifySignup(token);
    dn = result?.dn ? safeDomain(result.dn) : null;
  } catch (err: any) {
    console.error("waitlist verify failed:", err?.message);
  }

  if (dn) {
    const tenantOverride = await getTenantConfig(dn).catch(() => null);
    const brand = configFor(dn, { tenantOverride }).brand;
    // moshcoding.com signups go to the tenant page; a real parked domain to itself.
    const dest = dn === "moshcoding.com" ? appBaseUrl() : `https://${dn}`;
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url=${esc(dest)}">
<title>You're in — ${esc(brand)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <main style="max-width:440px;padding:32px;text-align:center">
    <h1 style="font-size:24px;color:#9EF01A;margin:0 0 12px">You're in the ${esc(brand)} pit. 🤘</h1>
    <p style="line-height:1.6;color:#c9c9c9;margin:0 0 24px">Email confirmed. Taking you back to <b>${esc(dn)}</b>…</p>
    <a href="${esc(dest)}" style="display:inline-block;background:#9EF01A;color:#0b0b0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Continue →</a>
  </main>
</body></html>`;
    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const home = appBaseUrl();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expired or already used</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <main style="max-width:440px;padding:32px;text-align:center">
    <h1 style="font-size:24px;color:#ff5555;margin:0 0 12px">Link expired or already used</h1>
    <p style="line-height:1.6;color:#c9c9c9;margin:0 0 24px">This confirmation link is invalid, expired, or already used. Re-join the waitlist to get a fresh one.</p>
    <a href="${esc(home)}" style="display:inline-block;background:#9EF01A;color:#0b0b0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Back to moshcoding</a>
  </main>
</body></html>`;
  return new NextResponse(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
