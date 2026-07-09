import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = authConfigured() ? readSession(req.cookies.get(SESSION_COOKIE)?.value) : null;
  return NextResponse.json({
    authEnabled: authConfigured(),
    user: s ? { sub: s.sub, email: s.email, name: s.name ?? null } : null,
  });
}
