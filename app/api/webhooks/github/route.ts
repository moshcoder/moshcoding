import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { isEmailConfigured, sendGithubClosedNotification } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub webhook receiver — emails a notification when a PR or issue is closed.
// Configure on the repo (Settings → Webhooks): payload URL
// <APP_BASE_URL>/api/webhooks/github, content-type application/json, secret =
// GITHUB_WEBHOOK_SECRET, events = Issues + Pull requests. Verified via the
// X-Hub-Signature-256 HMAC GitHub sends.
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  if (!secret) return true; // not yet configured — accept (dev)
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function notifyTo(): string {
  return process.env.NOTIFY_EMAIL || "moshcoder@gmail.com";
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event") || "";
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });

  let p: any = {};
  try { p = raw ? JSON.parse(raw) : {}; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const repo = p?.repository?.full_name || "github";
  const actor = p?.sender?.login || "someone";

  let closed: { kind: "pull request" | "issue"; obj: any; merged?: boolean } | null = null;
  if (event === "pull_request" && p?.action === "closed") {
    closed = { kind: "pull request", obj: p.pull_request, merged: Boolean(p.pull_request?.merged) };
  } else if (event === "issues" && p?.action === "closed") {
    closed = { kind: "issue", obj: p.issue };
  }

  if (closed?.obj) {
    if (isEmailConfigured()) {
      const sent = await sendGithubClosedNotification({
        to: notifyTo(),
        kind: closed.kind,
        repo,
        number: Number(closed.obj.number) || 0,
        title: String(closed.obj.title || "").slice(0, 200),
        url: String(closed.obj.html_url || ""),
        actor,
        merged: closed.merged,
      });
      if (!sent.ok) console.error("[github webhook] email failed:", sent.error);
    } else {
      console.log(`[github webhook] ${repo} ${closed.kind} #${closed.obj.number} closed (email not configured)`);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "github webhook", events: ["issues.closed", "pull_request.closed"] });
}
