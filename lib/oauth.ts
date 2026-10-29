// Sign in with CoinPay: a confidential OIDC client. Authorization code +
// PKCE S256 + state + nonce, the client secret on the code exchange, and the
// id_token checked (issuer, audience, expiry, nonce) with a userinfo `sub`
// that must match it. The protocol half lives in the house package
// @profullstack/coinpay-onboard/oauth; this file only adds our config.
//
// Bind the result to an account by `sub` only (lib/db accountIdForCoinpay).
// CoinPay never verifies addresses: the email is contact information.
import {
  authorizeUrl as cpAuthorizeUrl,
  finishSignIn,
  pkce,
  randomToken,
  sameState,
  SIGN_IN_SCOPES,
} from "@profullstack/coinpay-onboard/oauth";

export const COINPAY_ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/$/, "");
export const COINPAY_CLIENT_ID = process.env.COINPAY_CLIENT_ID || "";
export const COINPAY_CLIENT_SECRET = process.env.COINPAY_CLIENT_SECRET || "";
export const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

/** Fallback redirect_uri for callers that have no request in hand. Per-request
 *  callers pass an explicit one derived from the host -- see lib/oauth-origin. */
export const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `${APP_BASE_URL}/auth/coinpay/callback`;

/** "login" signs in (or creates a CoinPay-bound account); "connect" links
 *  CoinPay to the password account that is already signed in. */
export type OAuthMode = "login" | "connect";

/** The short-lived cookies the start route sets and the callback reads. */
export const PENDING_COOKIES = { verifier: "cp_pkce", state: "cp_state", nonce: "cp_nonce", mode: "cp_mode" } as const;

export function makePkce() {
  const { verifier, challenge } = pkce();
  return { verifier, challenge, state: randomToken(24), nonce: randomToken(24) };
}

export function authorizeUrl(challenge: string, state: string, redirectUri: string = REDIRECT_URI, nonce?: string): string {
  return cpAuthorizeUrl({
    base: COINPAY_ISSUER,
    clientId: COINPAY_CLIENT_ID,
    redirectUri,
    state,
    challenge,
    nonce,
    scopes: SIGN_IN_SCOPES,
  });
}

/** Constant-time state compare; false when either side is missing. */
export function stateMatches(expected: string | null | undefined, received: string | null | undefined): boolean {
  return sameState(expected, received);
}

/**
 * Code -> tokens -> checked id_token -> userinfo. `redirectUri` must byte-match
 * the one sent to authorize (both come from lib/oauth-origin). Throws on any
 * failure, including a nonce or audience mismatch.
 */
export async function finishCoinpaySignIn(
  input: { code: string; verifier: string; nonce: string; redirectUri: string },
  doFetch?: typeof fetch,
) {
  return finishSignIn({
    code: input.code,
    verifier: input.verifier,
    nonce: input.nonce,
    redirectUri: input.redirectUri,
    clientId: COINPAY_CLIENT_ID,
    clientSecret: COINPAY_CLIENT_SECRET,
    base: COINPAY_ISSUER,
    fetch: doFetch,
  });
}
