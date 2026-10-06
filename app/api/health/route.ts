import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3000;
const headers = { "Cache-Control": "no-store" };

// Public health check for status.profullstack.com: one `select 1` with a 3s
// ceiling. No auth and no error details in the response.
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db().execute("select 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ status: "ok", db: "ok" }, { headers });
  } catch {
    return NextResponse.json({ status: "error", db: "down" }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
