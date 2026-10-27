import type { NextRequest } from "next/server";
import { requestHosts, resolveOrigin } from "./oauth-origin";

function requestIsHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  return req.nextUrl.protocol === "https:" || (process.env.APP_BASE_URL || "").startsWith("https://");
}

/**
 * The public origin of this request, for links we hand out (invite links,
 * confirm emails). Only an allowlisted host (APP_BASE_URL, OAUTH_ALLOWED_HOSTS)
 * is reflected; anything else falls back to APP_BASE_URL, never localhost.
 */
export function requestOrigin(req: NextRequest): string {
  return resolveOrigin(requestHosts(req.headers), requestIsHttps(req));
}
