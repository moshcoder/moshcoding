export const WAITLIST_STATUSES = ["all", "verified", "pending"] as const;
export const WAITLIST_SORTS = ["newest", "oldest", "email"] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export type WaitlistSort = (typeof WAITLIST_SORTS)[number];

export function parseWaitlistStatus(value: string | null): WaitlistStatus | null {
  if (value === null || value === "") return "all";
  return WAITLIST_STATUSES.includes(value as WaitlistStatus)
    ? (value as WaitlistStatus)
    : null;
}

export function parseWaitlistSort(value: string | null): WaitlistSort | null {
  if (value === null || value === "") return "newest";
  return WAITLIST_SORTS.includes(value as WaitlistSort)
    ? (value as WaitlistSort)
    : null;
}

export function filterSignupsByStatus<T extends { verified: boolean }>(
  signups: T[],
  status: WaitlistStatus,
): T[] {
  if (status === "all") return signups;
  return signups.filter((signup) =>
    status === "verified" ? signup.verified : !signup.verified,
  );
}

export function filterSignupsByQuery<T extends { email: string; ref?: string | null }>(
  signups: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return signups;

  return signups.filter(
    (signup) =>
      signup.email.toLowerCase().includes(normalizedQuery) ||
      signup.ref?.toLowerCase().includes(normalizedQuery),
  );
}
