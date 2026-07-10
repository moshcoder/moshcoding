import { upsertTenant, type Account } from "@/lib/db";

/**
 * Provisions the tenant page for a paid account: builds the override config from
 * the account's handles and writes the `tenants` row so moshcoding.com/?dn=<domain>
 * renders their linktree. No-op if the account has no domain.
 */
export async function provisionTenant(acct: Account): Promise<void> {
  if (!acct.domain) return;
  // The account's editable config is the source of truth; fall back to handles
  // for older accounts that never saved a config.
  const config: Record<string, unknown> =
    acct.config && Object.keys(acct.config).length > 0
      ? acct.config
      : (acct.handles && Object.keys(acct.handles).length > 0 ? { socials: acct.handles } : {});
  await upsertTenant(acct.domain, acct.id, config);
}
