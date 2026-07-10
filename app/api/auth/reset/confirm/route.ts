import { NextRequest, NextResponse } from "next/server";
import { accountForResetToken, updatePassword } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/password";
import { authConfigured } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Accounts are not enabled yet." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const token = String(body?.token || "");
  const pwProblem = passwordProblem(body?.password);
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

  const accountId = await accountForResetToken(token);
  if (!accountId) {
    return NextResponse.json({ error: "That reset link is invalid or expired." }, { status: 400 });
  }
  const { hash, salt } = await hashPassword(String(body.password));
  await updatePassword(accountId, hash, salt);
  return NextResponse.json({ ok: true });
}
