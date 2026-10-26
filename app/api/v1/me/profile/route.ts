import { createProfileHandlers } from "@profullstack/profile";
import { ensureSchema } from "@/lib/db";
import { profiles } from "@/lib/profile";
import { authConfigured, readSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionUser(req: Request) {
  if (!authConfigured()) return null;
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const s = readSession(raw ? decodeURIComponent(raw) : null);
  return s ? { id: s.sub, email: s.email } : null;
}

// GET/PUT/PATCH /api/v1/me/profile: the package's own handlers for the signed-in
// account. Built per request so nothing touches the database at build time.
async function handlers() {
  await ensureSchema();
  return createProfileHandlers({ store: profiles(), getUser: sessionUser });
}

export async function GET(req: Request) {
  if (!sessionUser(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return (await handlers()).GET(req);
}
export async function PUT(req: Request) {
  if (!sessionUser(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return (await handlers()).PUT(req);
}
export async function PATCH(req: Request) {
  if (!sessionUser(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return (await handlers()).PATCH(req);
}
