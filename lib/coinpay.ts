// Server-to-server CoinPayPortal payments for the $1 account-setup fee.
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

/** True once a payment API key is configured; otherwise callers auto-activate. */
export function payConfigured(): boolean {
  return Boolean(API_KEY);
}

export function payUrl(id: string): string {
  return `${ISSUER}/pay/${encodeURIComponent(id)}`;
}

export type CreatedPayment = { id: string; status: string; payUrl: string };

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
    amountUsd: Number(opts.amount || SETUP_FEE_USD),
    currency: PAY_CHAIN.toLowerCase(),
    paymentMethod: "crypto",
    description: `moshcoding account setup — ${opts.domain}`,
    metadata: { kind: "account_setup", account_id: opts.accountId, email: opts.email, domain: opts.domain },
    ...(opts.redirectUrl ? { redirectUrl: opts.redirectUrl } : {}),
    ...(BUSINESS_ID ? { businessId: BUSINESS_ID } : {}),
  });
  return { id: paymentId, status: payment.status || "pending", payUrl: payUrl(paymentId) };
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
