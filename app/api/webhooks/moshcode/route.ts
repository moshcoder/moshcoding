import { NextRequest, NextResponse } from "next/server";
import { verifyMoshcodeSignature } from "@/lib/moshcode-webhook-signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMoshcodeSignature(raw, req.headers.get("x-moshcode-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: any = {};
  try { evt = raw ? JSON.parse(raw) : {}; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  console.log("[moshcode webhook]", evt?.type || "(no type)", JSON.stringify(evt).slice(0, 500));
  // TODO: handle event types once defined (e.g. login/entitlement/usage).
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "moshcode webhook", methods: ["POST"] });
}
