import { NextRequest, NextResponse } from "next/server";
import { addSignup } from "@/lib/db";
import { safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body?.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
  }
  const dn = body?.dn ? safeDomain(body.dn) : null;
  if (body?.dn && !dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  try {
    const result = await addSignup({ email, dn: dn || "moshcoding.com", ua: req.headers.get("user-agent") });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("waitlist insert failed:", err?.message);
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }
}
