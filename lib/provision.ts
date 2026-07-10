import { upsertTenant, type Account } from "@/lib/db";

/**
 * Provisions the tenant page for a paid account: builds the override config from
 * the account's handles and writes the `tenants` row so moshcoding.com/?dn=<domain>
 * renders their linktree. No-op if the account has no domain.
 */
export async function provisionTenant(acct: Account): Promise<void> {
  if (!acct.domain) return;
  const config: Record<string, unknown> = {};
  if (acct.handles && Object.keys(acct.handles).length > 0) {
    config.socials = acct.handles;
  }
  await upsertTenant(acct.domain, acct.id, config);
}
