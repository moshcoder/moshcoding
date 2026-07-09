import crypto from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "";
export const SESSION_COOKIE = "mc_session";
export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export type Session = { sub: string; email: string | null; name: string | null; iat: number };

const b64url = (buf: crypto.BinaryLike) => Buffer.from(buf as any).toString("base64url");

export function authConfigured(): boolean {
  return Boolean(
    process.env.COINPAY_CLIENT_ID && process.env.COINPAY_CLIENT_SECRET && SESSION_SECRET
  );
}

export function signSession(payload: { sub: string; email: string | null; name: string | null }): string {
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function readSession(token: string | undefined | null): Session | null {
  if (!SESSION_SECRET || !token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data.iat || Date.now() / 1000 - data.iat > SESSION_TTL) return null;
    return data as Session;
  } catch {
    return null;
  }
}
