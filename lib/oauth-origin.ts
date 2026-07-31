// Which origin this app hands to the IdP as an OAuth `redirect_uri`.
//
// The app answers on more than one hostname (moshcoding.com and
// pit.moshcode.sh both route to this service). A `redirect_uri` pinned to a
// single origin breaks login on every other one: the `cp_pkce` / `cp_state`
// cookies are host-only, so they are set on the host the user started from and
// are simply absent when the IdP sends the browser back to the pinned host --
// the callback fails "state mismatch" before it can do anything useful.
//
// SECURITY: the Host header is attacker-controlled. Reflecting it into a
// redirect_uri unchecked hands the authorization code to whatever host an
// attacker names. So a host only becomes an origin if it is on the allowlist;
// anything else silently falls back to APP_BASE_URL. We do not rely on the
// IdP's own redirect_uri registration to catch this -- that is a second line of
// defense, not the first.

const stripSlash = (s: string) => s.replace(/\/+$/, "");

/** The origin used when the request host is unknown or not allowlisted. */
export function defaultOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return stripSlash(env.APP_BASE_URL || "http://localhost:8080");
}

/** Bare hostname (with port, if any) from a host header or an origin string. */
function normalizeHost(raw: string): string {
  return raw
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * The host this request was addressed to. Prefers x-forwarded-host, which the
 * platform edge sets to the client-facing name; `host` alone can be the
 * internal upstream. Still untrusted -- resolveOrigin allowlists it.
 */
export function requestHost(headers: Headers): string {
  return headers.get("x-forwarded-host") || headers.get("host") || "";
}

/**
 * Hosts allowed to appear in a redirect_uri: always APP_BASE_URL's own host,
 * plus any listed in OAUTH_ALLOWED_HOSTS (comma-separated; bare hosts or full
 * origins both work, e.g. "pit.moshcode.sh, https://moshcode.sh").
 */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(defaultOrigin(env)).host.toLowerCase());
  } catch {
    // APP_BASE_URL is malformed; the allowlist just starts empty.
  }
  for (const entry of (env.OAUTH_ALLOWED_HOSTS || "").split(",")) {
    const host = normalizeHost(entry);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Resolve the origin to use for this request. Returns an allowlisted
 * `scheme://host`, or `defaultOrigin()` when the host is missing, unparseable
 * or not allowlisted.
 *
 * Both the authorize step and the callback derive the redirect_uri through
 * this function. They agree because the callback necessarily arrives on the
 * host the authorize step named -- and a rejected host maps to APP_BASE_URL,
 * whose own host is always allowlisted, so that case agrees too. That matters:
 * OAuth requires the redirect_uri at token exchange to match the one sent to
 * authorize byte for byte.
 */
export function resolveOrigin(
  hostHeader: string | null | undefined,
  isHttps: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = normalizeHost(hostHeader || "");
  if (!host) return defaultOrigin(env);
  if (!allowedHosts(env).has(host)) return defaultOrigin(env);
  return `${isHttps ? "https" : "http"}://${host}`;
}

/**
 * The full redirect_uri for an origin. OAUTH_REDIRECT_URI still wins when set,
 * so an operator can pin one explicitly and keep the old single-origin
 * behaviour.
 */
export function redirectUriFor(origin: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.OAUTH_REDIRECT_URI || `${stripSlash(origin)}/auth/coinpay/callback`;
}
