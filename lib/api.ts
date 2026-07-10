import { NextRequest, NextResponse } from "next/server";
import { sessionUser, getOrCreateUser } from "./authz";

/** Resolve the authenticated user (provisioning a default org/team on first hit). */
export async function requireUser(req: NextRequest) {
  const s = sessionUser(req);
  if (!s) return null;
  await getOrCreateUser(s.sub, s.email, s.name);
  return s;
}

export const unauthorized = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });
export const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
