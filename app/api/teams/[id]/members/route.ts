import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeTeam, canAssignRole, type Role } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITABLE: Role[] = ["admin", "member", "viewer"];

// members + pending invitations for a team
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: teamId } = await ctx.params;
  const az = await authorizeTeam(u.sub, teamId, "project.read");
  if (!az.ok) return bad(az.error, az.status);

  const members = await db().execute({
    sql: `SELECT tm.user_sub, tm.role, u.email, u.name FROM team_members tm
          LEFT JOIN users u ON u.sub = tm.user_sub WHERE tm.team_id = ? ORDER BY tm.created_at`,
    args: [teamId],
  });
  const invites = await db().execute({
    sql: `SELECT email, role, token, expires_at FROM team_invitations
          WHERE team_id = ? AND accepted_at IS NULL ORDER BY created_at`,
    args: [teamId],
  });
  return NextResponse.json({ role: az.role, members: members.rows, invitations: invites.rows });
}

// invite a member by email (needs team.manage)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { id: teamId } = await ctx.params;
  const az = await authorizeTeam(u.sub, teamId, "team.manage");
  if (!az.ok) return bad(az.error, az.status);

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "member") as Role;
  if (!EMAIL_RE.test(email)) return bad("valid email required");
  if (!INVITABLE.includes(role)) return bad("role must be admin, member, or viewer");
  if (!canAssignRole(az.role, role)) return bad("you can't assign a role at or above your own", 403);

  try {
    const res = await db().execute({
      sql: `INSERT INTO team_invitations (team_id, email, role, invited_by) VALUES (?, ?, ?, ?)
            RETURNING email, role, token, expires_at`,
      args: [teamId, email, role, u.sub],
    });
    return NextResponse.json({ invitation: res.rows[0] }, { status: 201 });
  } catch {
    return bad("that email is already invited to this team", 409);
  }
}
