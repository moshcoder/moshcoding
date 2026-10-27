// Admin for credit codes and invites, run where DATABASE_URL points at the
// app's database. On dev2:
//   docker exec moshcodingcom-app-1 bun scripts/credit-codes.ts mint --days 30 --label "for X" [--max 1] [--expires-days 90] [--json]
//   docker exec moshcodingcom-app-1 bun scripts/credit-codes.ts list
//   docker exec moshcodingcom-app-1 bun scripts/credit-codes.ts revoke crd_xxx
//   docker exec moshcodingcom-app-1 bun scripts/credit-codes.ts quota you@example.com 10
// A code grants `pro_days`: days of the paid affiliate plan ($1/mo).
import { credits, affiliates, CREDIT_UNIT } from "../lib/credits";
import { getAccountByEmail, getAccountById } from "../lib/db";

const DAY_MS = 86_400_000;
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const json = rest.includes("--json");

async function main() {
  if (cmd === "mint") {
    const days = Number(flag("days"));
    if (!Number.isInteger(days) || days <= 0 || days > 3660) throw new Error("--days must be a whole number of days (1-3660)");
    const max = flag("max") ? Number(flag("max")) : 1;
    if (!Number.isInteger(max) || max <= 0) throw new Error("--max must be a positive whole number");
    const expiresDays = flag("expires-days") ? Number(flag("expires-days")) : null;
    const minted = await credits().mint({
      grant: { unit: CREDIT_UNIT, amount: days },
      label: flag("label") || "",
      maxRedemptions: max,
      expiresAt: expiresDays ? Date.now() + expiresDays * DAY_MS : null,
      prefix: "MOSH",
      createdBy: "cli",
    });
    if (json) console.log(JSON.stringify(minted));
    else console.log(`${minted.code}  (${minted.id}: ${days} days of the paid plan, ${max} use${max === 1 ? "" : "s"}${minted.expiresAt ? `, redeem by ${new Date(minted.expiresAt).toISOString().slice(0, 10)}` : ""})`);
  } else if (cmd === "list") {
    const list = await credits().list();
    if (json) console.log(JSON.stringify(list));
    else for (const c of list) console.log(`${c.id}  ${c.grant.amount} ${c.grant.unit}  ${c.redemptions}/${c.maxRedemptions}${c.revokedAt ? "  revoked" : ""}  ${c.label}`);
  } else if (cmd === "revoke") {
    if (!rest[0]) throw new Error("usage: revoke <code id>");
    await credits().revoke(rest[0]);
    console.log(`revoked ${rest[0]}`);
  } else if (cmd === "quota") {
    const [who, n] = rest;
    const acct = who?.includes("@") ? await getAccountByEmail(who) : await getAccountById(who || "");
    if (!acct || !Number.isInteger(Number(n))) throw new Error("usage: quota <email|account id> <total>");
    await affiliates().setQuota(acct.id, Number(n));
    console.log(`${acct.email}: ${JSON.stringify(await affiliates().quota(acct.id))}`);
  } else {
    console.log("usage: credit-codes.ts mint --days N [--max N] [--expires-days N] [--label L] [--json] | list | revoke <id> | quota <email|id> <n>");
    process.exitCode = cmd ? 1 : 0;
  }
}

main().then(() => process.exit(process.exitCode ?? 0), (err) => {
  console.error(err?.message || err);
  process.exit(1);
});
