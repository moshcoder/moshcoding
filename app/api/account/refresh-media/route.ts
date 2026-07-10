import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, unauthorized } from "@/lib/api";
import { getAccountById, updateAccountConfig } from "@/lib/db";
import { provisionTenant } from "@/lib/provision";
import { listRepoAssets } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-pull media (images / video / audio) from the account's connected GitHub
// repo and refresh config.assets — without touching any other config field.
export async function POST(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();

  const acct = await getAccountById(id);
  if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const config: Record<string, any> = { ...(acct.config || {}) };
  if (!config.repo) {
    return NextResponse.json({ error: "Connect a GitHub repo first (owner/name), then Save." }, { status: 400 });
  }

  let assets: Awaited<ReturnType<typeof listRepoAssets>>;
  try {
    assets = await listRepoAssets(config.repo, { pattern: config.assetPattern });
  } catch (e: any) {
    return NextResponse.json({ error: `Couldn't load from ${config.repo}: ${e?.message || e}` }, { status: 502 });
  }

  config.assets = assets;
  const updated = await updateAccountConfig(id, config);
  if (updated?.status === "active") await provisionTenant(updated);

  const counts: Record<string, number> = {};
  for (const x of assets) {
    const k = x.kind || "image";
    counts[k] = (counts[k] || 0) + 1;
  }
  return NextResponse.json({ ok: true, total: assets.length, counts, assets });
}
