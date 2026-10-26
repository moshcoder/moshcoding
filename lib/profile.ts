import { createProfileStore, type ProfileStore } from "@profullstack/profile";
import { db } from "./db";

/**
 * The shared Profullstack profile (@profullstack/profile): email, names,
 * company domain, job title and LinkedIn in `user_profiles` (created by
 * ensureSchema), keyed by the session `sub`: "acct:<id>" for a native account,
 * the OIDC sub for CoinPay. Private to its owner: only /api/v1/me/profile reads it.
 */
let store: ProfileStore | undefined;
export function profiles(): ProfileStore {
  store ??= createProfileStore(db(), { key: "user_id", keyType: "text" });
  return store;
}
