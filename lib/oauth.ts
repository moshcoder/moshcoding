import crypto from "node:crypto";

export const COINPAY_ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/$/, "");
export const COINPAY_CLIENT_ID = process.env.COINPAY_CLIENT_ID || "";
export const COINPAY_CLIENT_SECRET = process.env.COINPAY_CLIENT_SECRET || "";
export const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
export const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `${APP_BASE_URL}/auth/coinpay/callback`;

const b64url = (buf: crypto.BinaryLike) => Buffer.from(buf as any).toString("base64url");

export function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export function authorizeUrl(challenge: string, state: string): string {
  const u = new URL(`${COINPAY_ISSUER}/api/oauth/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: COINPAY_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string) {
  const res = await fetch(`${COINPAY_ISSUER}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: COINPAY_CLIENT_ID,
      client_secret: COINPAY_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return res.json();
}

export async function fetchUserinfo(accessToken: string) {
  const res = await fetch(`${COINPAY_ISSUER}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed (${res.status})`);
  return res.json();
}
