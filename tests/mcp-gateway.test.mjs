import assert from "node:assert/strict";
import test from "node:test";
import { mcpGatewayTarget } from "../lib/mcp-gateway.ts";

test("Moshcode share and discovery URLs reach the fixed app authority", () => {
  for (const path of [
    "/api/v1/mcp/mcs_example", "/api/v1/mcp/shares", "/api/v1/mcp/shares/mcs_example",
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource/api/v1/mcp/mcs_example",
  ]) assert.equal(mcpGatewayTarget("moshcode.sh", path).href, `https://app.moshcode.sh${path}`);
});

test("a caller cannot change the bearer-token destination through path or query input", () => {
  assert.equal(mcpGatewayTarget("moshcode.sh", "/api/v1/mcp/mcs_example", "?upstream=https://evil.example").origin,
    "https://app.moshcode.sh");
  for (const path of ["//evil.example/api/v1/mcp/x", "/api/v1/mcp/../oauth/token", "/api/v1/mcp/%2f%2fevil.example", "/api/v1/mcp/x/../../../oauth/token"])
    assert.equal(mcpGatewayTarget("moshcode.sh", path), null);
});

test("tenant sites, account routes and ordinary pages stay outside the gateway", () => {
  for (const host of ["moshcoding.com", "moshscript.com", "moshcode.sh.evil.example", "moshcode.sh:8080", ""])
    assert.equal(mcpGatewayTarget(host, "/api/v1/mcp/mcs_example"), null);
  for (const path of ["/", "/oauth/authorize", "/oauth/token", "/api/v1/me", "/api/sessions", "/api/v1/mcp"])
    assert.equal(mcpGatewayTarget("moshcode.sh", path), null);
});
