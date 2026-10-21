// Server-to-server CoinPayPortal payments for claiming a Moshpit ending.
//
// The HTTP client is `createCoinPayClient` from @profullstack/stack/coinpay:
//   POST <ISSUER>/api/checkout/sessions  Authorization: Bearer <cp_live_ key>
//     -> { id: "cs_...", url, methods }
//   Hosted checkout = <ISSUER>/checkout/<cs_id>: the buyer picks any coin the
//                     business has a wallet for, or PayPal.
//   Confirmation    = webhook signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
//                     (verified in the webhook route); its data carries
//                     checkout_session_id, customer_email, account_id, property.
//
// When COINPAY_API_KEY is unset (local dev / not yet provisioned) payConfigured()
// is false and callers register without charging, so the flow is testable
// offline. The money is collected to moshcoding's own business wallets — the
// per-user payout wallet on an account is for that user's OWN future earnings,
// not for this charge.
import { createCoinPayClient } from "@profullstack/stack/coinpay";

const ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/+$/, "");
const API_KEY = process.env.COINPAY_API_KEY || "";
const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID || "";

/** The site hostname sent as `property` on every checkout. */
export const PROPERTY = "moshcoding.com";

/** What claiming one Moshpit ending costs. See app/api/moshpit/tlds/route.ts. */
export const CLAIM_PRICE_USD = process.env.MOSHPIT_CLAIM_PRICE_USD || "10.00";

/**
 * How long a claim holds the name while its payment is outstanding.
 *
 * A crypto payment is not instant, so the ending has to be reserved across the
 * round-trip or two people can pay for the same one. The hold is deliberately
 * short: an abandoned checkout must not park a name indefinitely.
 */
export const CLAIM_HOLD_MINUTES = Math.max(
  1,
  Math.min(1440, Number(process.env.MOSHPIT_CLAIM_HOLD_MINUTES || 30) || 30),
);

/** True once a payment API key is configured; otherwise claiming is free. */
export function payConfigured(): boolean {
  return Boolean(API_KEY);
}

/** True for a hosted checkout session id (`cs_...`). */
export function isCheckoutSessionId(id: unknown): id is string {
  return typeof id === "string" && /^cs_[A-Za-z0-9]+$/.test(id);
}

/**
 * Where to send the buyer for a stored id: the hosted checkout for a session,
 * the single-coin pay page for a payment made before sessions.
 */
export function payUrl(id: string): string {
  const path = isCheckoutSessionId(id) ? "checkout" : "pay";
  return `${ISSUER}/${path}/${encodeURIComponent(id)}`;
}

/** Session lifetime CoinPay accepts: 15 to 120 minutes. */
export function sessionMinutes(holdMinutes: number): number {
  const n = Math.round(Number(holdMinutes) || 0);
  return Math.min(120, Math.max(15, n));
}

export type CreatedPayment = { id: string; status: string; payUrl: string };

const AMOUNT_RE = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

/**
 * The claim price as a number.
 *
 * Parsed on every call rather than at module load: a bad
 * MOSHPIT_CLAIM_PRICE_USD must fail the request that would have charged it,
 * not the import that happens to touch this module first — a throw at import
 * time takes down the availability lookup and the public page with it.
 *
 * Fractional cents are rejected rather than rounded. A price that cannot be
 * charged exactly is a configuration mistake, and quietly charging the nearest
 * chargeable amount is how you end up billing something nobody chose.
 */
export function claimPriceUsd(value: unknown = CLAIM_PRICE_USD): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error("payment amount must be positive");
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(value - rounded) > Number.EPSILON) throw new Error("payment amount must not have fractional cents");
    return rounded;
  }

  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!AMOUNT_RE.test(text)) throw new Error("payment amount must be a positive dollar amount");
  const amount = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("payment amount must be positive");
  return amount;
}

/** "10" / "10.5" -> "10.00", for display and for storing what was charged. */
export function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Charge for claiming a Moshpit ending with a hosted checkout session.
 *
 * The buyer comes back to /pit carrying the claim id (and the session id),
 * because the hosted page returns them before the webhook necessarily lands;
 * the page polls the claim rather than assuming it already went through.
 *
 * The session lifetime follows the hold the registry places on the name
 * (clamped to CoinPay's 15 to 120 minutes), so the checkout does not stay
 * payable long after the reservation it depends on is gone.
 */
export async function createClaimPayment(opts: {
  claimId: string;
  accountId: string;
  email: string;
  tld: string;
  successUrl?: string;
  cancelUrl?: string;
  amount?: string;
  holdMinutes?: number;
}): Promise<CreatedPayment> {
  const coinpay = createCoinPayClient({ apiKey: API_KEY, baseUrl: ISSUER });
  const holdMinutes = opts.holdMinutes ?? CLAIM_HOLD_MINUTES;
  const { sessionId, checkoutUrl, session } = await coinpay.createCheckout({
    amountUsd: claimPriceUsd(opts.amount || CLAIM_PRICE_USD),
    customerEmail: opts.email,
    accountId: opts.accountId,
    property: PROPERTY,
    description: `Moshpit ending .${opts.tld}`,
    expiresInMinutes: sessionMinutes(holdMinutes),
    metadata: {
      kind: "tld_claim",
      claim_id: opts.claimId,
      tld: opts.tld,
    },
    ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
    ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
    ...(BUSINESS_ID ? { businessId: BUSINESS_ID } : {}),
  });
  return { id: sessionId, status: String(session.status || "open"), payUrl: checkoutUrl || payUrl(sessionId) };
}

const PAID = new Set(["confirmed", "forwarded", "completed", "paid"]);
/** CoinPay statuses that mean the money is in: confirmed/forwarded/completed, or a paid session. */
export function isPaidStatus(s: unknown): boolean {
  return typeof s === "string" && PAID.has(s.toLowerCase());
}

/**
 * Poll fallback when a webhook is missed: GET /api/checkout/sessions/<id> for a
 * session (status open, paid or expired), GET /api/payments/<id> for an older
 * single-coin payment.
 */
export async function fetchPaymentStatus(id: string): Promise<string | null> {
  try {
    const coinpay = createCoinPayClient({ apiKey: API_KEY, baseUrl: ISSUER });
    const { status } = isCheckoutSessionId(id) ? await coinpay.getCheckout(id) : await coinpay.getPayment(id);
    return status || null;
  } catch {
    return null;
  }
}
