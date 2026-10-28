import { NextRequest, NextResponse } from "next/server";
import { webhooksApi } from "@profullstack/webhooks";
import { resolveAccountIdOrToken } from "@/lib/api";
import { safeDomain } from "@/lib/config";
import { accountOwnsDomain } from "@/lib/db";
import { domainOwner, hooks } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The @profullstack/webhooks API for a parked domain's outbound targets:
//   GET/POST /api/v1/webhooks?dn=<domain>, GET/PATCH/DELETE /:id,
//   GET /:id/secret, POST /:id/rotate, POST /:id/test, GET /:id/deliveries,
//   GET /deliveries, POST /deliveries/:id/retry
// Auth: the dashboard session or `Authorization: Bearer <API key>`; the
// account must own the domain (pass it as ?dn= or an x-domain header).
let api: ReturnType<typeof webhooksApi> | undefined;
const owners = new WeakMap<Request, string>();

async function handle(req: NextRequest): Promise<Response> {
  const accountId = await resolveAccountIdOrToken(req);
  if (!accountId) return NextResponse.json({ error: "sign in or send an API key" }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn") || req.headers.get("x-domain"));
  if (!dn) return NextResponse.json({ error: "name the domain: ?dn=<domain> or an x-domain header" }, { status: 400 });
  if (!(await accountOwnsDomain(accountId, dn))) return NextResponse.json({ error: "You don't own this domain." }, { status: 403 });
  owners.set(req, domainOwner(dn));
  api ??= webhooksApi(hooks(), { basePath: "/api/v1/webhooks", owner: (r) => owners.get(r) ?? null });
  return (await api(req)) ?? NextResponse.json({ error: "not found" }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
