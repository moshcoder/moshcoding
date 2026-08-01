import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSignupsByQuery,
  filterSignupsByStatus,
  parseWaitlistStatus,
} from "../lib/waitlist-filter.ts";

test("parseWaitlistStatus accepts supported filters and defaults to all", () => {
  assert.equal(parseWaitlistStatus(null), "all");
  assert.equal(parseWaitlistStatus(""), "all");
  assert.equal(parseWaitlistStatus("all"), "all");
  assert.equal(parseWaitlistStatus("verified"), "verified");
  assert.equal(parseWaitlistStatus("pending"), "pending");
  assert.equal(parseWaitlistStatus("unknown"), null);
});

test("filterSignupsByStatus keeps the requested verification state", () => {
  const signups = [
    { email: "confirmed@example.com", verified: true },
    { email: "pending@example.com", verified: false },
  ];

  assert.equal(filterSignupsByStatus(signups, "all"), signups);
  assert.deepEqual(filterSignupsByStatus(signups, "verified"), [signups[0]]);
  assert.deepEqual(filterSignupsByStatus(signups, "pending"), [signups[1]]);
});

test("filterSignupsByQuery matches email and referral code", () => {
  const signups = [
    { email: "Alice@Example.com", ref: "FRIEND-42" },
    { email: "bob@example.com", ref: null },
  ];

  assert.deepEqual(filterSignupsByQuery(signups, " alice "), [signups[0]]);
  assert.deepEqual(filterSignupsByQuery(signups, "friend-42"), [signups[0]]);
  assert.deepEqual(filterSignupsByQuery(signups, "BOB@"), [signups[1]]);
  assert.deepEqual(filterSignupsByQuery(signups, "missing"), []);
  assert.equal(filterSignupsByQuery(signups, "  "), signups);
});
