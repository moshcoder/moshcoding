export const WAITLIST_STATUSES = ["all", "verified", "pending"] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export function parseWaitlistStatus(value: string | null): WaitlistStatus | null {
  if (value === null || value === "") return "all";
  return WAITLIST_STATUSES.includes(value as WaitlistStatus)
    ? (value as WaitlistStatus)
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
