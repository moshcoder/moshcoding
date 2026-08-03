import { NextRequest, NextResponse } from "next/server";
import { sessionUser, getOrCreateUser } from "./authz";
import { readSession, authConfigured, SESSION_COOKIE } from "./session";
import { findOrCreateAccountByEmail } from "./db";
import { accountIdForToken, bearerToken } from "./apikeys";

/** Resolve the authenticated user (provisioning a default org/team on first hit). */
export async function requireUser(req: NextRequest) {
  const s = sessionUser(req);
  if (!s) return null;
  await getOrCreateUser(s.sub, s.email, s.name);
  return s;
}

/**
 * Resolves the tenant *account* id for the session — native (`acct:<id>`) or a
 * CoinPay-OAuth user (looked up / created by email). This is the identity the
 * dashboard's page/waitlist/auctions/media features are scoped to.
 */
export async function resolveAccountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

/**
 * The account for a request, accepting an API key as well as a session.
 *
 * Separate from `resolveAccountId` rather than folded into it, so that adding
 * a key path does not silently widen every account-scoped endpoint at once.
 * A route opts in by calling this one, and the diff shows which routes did.
 *
 * Session first: a browser request carries both a cookie and, sometimes, an
 * unrelated Authorization header, and the cookie is the stronger statement of
 * who is driving.
 */
export async function resolveAccountIdOrToken(req: NextRequest): Promise<string | null> {
  const session = await resolveAccountId(req);
  if (session) return session;
  return accountIdForToken(bearerToken(req.headers.get("authorization")));
}

export const unauthorized = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });
export const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
