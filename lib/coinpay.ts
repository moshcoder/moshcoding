// Server-to-server CoinPayPortal payments: the account-setup fee, and the
// charge for claiming a Moshpit ending (`.eggs`).
//
// The HTTP client is `createCoinPayClient` from @profullstack/stack/coinpay:
//   POST <ISSUER>/api/payments/create   Authorization: Bearer <cp_live_ key>
//     -> { payment: { id, status, ... } }
//   Hosted pay page  = <ISSUER>/pay/<id>   (constructed from the returned id)
//   Confirmation     = webhook signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
//                      (verified with verifyCoinPayWebhook in the webhook route),
//                      event "payment.confirmed".
//
// When COINPAY_API_KEY is unset (local dev / not yet provisioned) payConfigured()
// is false and callers auto-activate instead of charging, so the flow is testable
// offline. The $1 fee is collected to moshcoding's own business payout wallet — a
// per-user payout wallet is captured on the account for the user's OWN future
// earnings, not for this charge.
import { createCoinPayClient } from "@profullstack/stack/coinpay";

const ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/+$/, "");
const API_KEY = process.env.COINPAY_API_KEY || "";
const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID || "";
const PAY_CHAIN = process.env.COINPAY_PAY_CHAIN || "USDC_POL";

export const SETUP_FEE_USD = process.env.SETUP_FEE_USD || "1.00";

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

/** True once a payment API key is configured; otherwise callers auto-activate. */
export function payConfigured(): boolean {
  return Boolean(API_KEY);
}

export function payUrl(id: string): string {
  return `${ISSUER}/pay/${encodeURIComponent(id)}`;
}

export type CreatedPayment = { id: string; status: string; payUrl: string };

const SETUP_AMOUNT_RE = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

export function setupAmountUsd(value: unknown = SETUP_FEE_USD): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error("setup payment amount must be positive");
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(value - rounded) > Number.EPSILON) throw new Error("setup payment amount must not have fractional cents");
    return rounded;
  }

  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!SETUP_AMOUNT_RE.test(text)) throw new Error("setup payment amount must be a positive dollar amount");
  const amount = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("setup payment amount must be positive");
  return amount;
}

/**
 * The claim price as a number, validated the same way the setup fee is.
 *
 * Parsed on every call rather than at module load: a bad
 * MOSHPIT_CLAIM_PRICE_USD must fail the request that would have charged it,
 * not the import that happens to touch this module first — a throw at import
 * time takes down the availability lookup and the public page with it.
 */
export function claimPriceUsd(value: unknown = CLAIM_PRICE_USD): number {
  return setupAmountUsd(value);
}

/** "10" / "10.5" -> "10.00", for display and for storing what was charged. */
export function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

export async function createSetupPayment(opts: {
  accountId: string;
  email: string;
  domain: string;
  redirectUrl?: string;
  amount?: string;
}): Promise<CreatedPayment> {
  // Lazy construction: createCoinPayClient throws without an apiKey, and this
  // module is imported even when CoinPay isn't configured (offline dev mode).
  const coinpay = createCoinPayClient({ apiKey: API_KEY, baseUrl: ISSUER });
  const { paymentId, payment } = await coinpay.createCheckout({
    amountUsd: setupAmountUsd(opts.amount || SETUP_FEE_USD),
    currency: PAY_CHAIN.toLowerCase(),
    paymentMethod: "crypto",
    description: `moshcoding account setup — ${opts.domain}`,
    metadata: { kind: "account_setup", account_id: opts.accountId, email: opts.email, domain: opts.domain },
    ...(opts.redirectUrl ? { redirectUrl: opts.redirectUrl } : {}),
    ...(BUSINESS_ID ? { businessId: BUSINESS_ID } : {}),
  });
  return { id: paymentId, status: payment.status || "pending", payUrl: payUrl(paymentId) };
}

/**
 * Charge for claiming a Moshpit ending.
 *
 * The redirect goes back to /pit carrying the payment id, because the hosted
 * page returns the customer before the webhook necessarily lands — the page
 * polls that id rather than assuming the claim already went through.
 *
 * `expiresIn` is tied to the same hold the registry places on the name, so the
 * payment cannot still be payable after the reservation it depends on is gone.
 */
export async function createClaimPayment(opts: {
  claimId: string;
  accountId: string;
  email: string | null;
  tld: string;
  redirectUrl?: string;
  amount?: string;
  holdMinutes?: number;
}): Promise<CreatedPayment> {
  const coinpay = createCoinPayClient({ apiKey: API_KEY, baseUrl: ISSUER });
  const holdMinutes = opts.holdMinutes ?? CLAIM_HOLD_MINUTES;
  const { paymentId, checkoutUrl, payment } = await coinpay.createCheckout({
    amountUsd: claimPriceUsd(opts.amount || CLAIM_PRICE_USD),
    currency: PAY_CHAIN.toLowerCase(),
    paymentMethod: "crypto",
    description: `moshpit ending — .${opts.tld}`,
    expiresIn: holdMinutes * 60,
    metadata: {
      kind: "tld_claim",
      claim_id: opts.claimId,
      tld: opts.tld,
      account_id: opts.accountId,
      ...(opts.email ? { email: opts.email } : {}),
    },
    ...(opts.redirectUrl ? { redirectUrl: opts.redirectUrl } : {}),
    ...(BUSINESS_ID ? { businessId: BUSINESS_ID } : {}),
  });
  // checkoutUrl is what the client returns; payUrl() is the same hosted page
  // derived from the id, kept as a fallback for an older API response.
  return { id: paymentId, status: payment.status || "pending", payUrl: checkoutUrl || payUrl(paymentId) };
}

const PAID = new Set(["confirmed", "forwarded", "completed"]);
/** CoinPay statuses that mean the money is in: confirmed/forwarded/completed. */
export function isPaidStatus(s: unknown): boolean {
  return typeof s === "string" && PAID.has(s.toLowerCase());
}

/** GET <ISSUER>/api/payments/<id> — poll fallback when a webhook is missed. */
export async function fetchPaymentStatus(id: string): Promise<string | null> {
  try {
    const coinpay = createCoinPayClient({ apiKey: API_KEY, baseUrl: ISSUER });
    const { status } = await coinpay.getCheckout(id);
    return status || null;
  } catch {
    return null;
  }
}
