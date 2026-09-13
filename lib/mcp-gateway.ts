// Only the Moshcode product host exposes this gateway. Other tenant domains
// remain independent, and neither a query parameter nor a forwarded host can
// choose the destination receiving a client's bearer token.
const MCP_UPSTREAM = "https://app.moshcode.sh";

export function mcpGatewayTarget(host: string, pathname: string, search = ""): URL | null {
  if (host.toLowerCase() !== "moshcode.sh") return null;
  const metadata = pathname === "/.well-known/oauth-authorization-server"
    || /^\/\.well-known\/oauth-protected-resource(?:\/mcp|\/api\/v1\/mcp\/[A-Za-z0-9_-]{1,128})?$/.test(pathname);
  const share = /^\/api\/v1\/mcp\/[A-Za-z0-9_-]{1,128}(?:\/[A-Za-z0-9_-]{1,128})?$/.test(pathname);
  if (!metadata && !share) return null;
  const target = new URL(pathname, MCP_UPSTREAM);
  target.search = search;
  return target;
}
