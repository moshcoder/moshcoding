// Server-to-server CoinPayPortal payments for the $1 account-setup fee.
//
// Contract (from the coinpayportal repo):
//   POST <ISSUER>/api/payments/create   Authorization: Bearer <cp_live_ key>
//     body { amount, blockchain, description, metadata, redirect_url, business_id? }
//     -> 201 { payment: { id, status, ... } }
//   Hosted pay page  = <ISSUER>/pay/<id>   (constructed from the returned id)
//   Confirmation     = webhook signed "X-CoinPay-Signature: t=<ts>,v1=<hmac>"
//                      (HMAC-SHA256 of "<ts>.<rawBody>"), event "payment.confirmed".
//
// When COINPAY_API_KEY is unset (local dev / not yet provisioned) payConfigured()
// is false and callers auto-activate instead of charging, so the flow is testable
// offline. The $1 fee is collected to moshcoding's own business payout wallet — a
// per-user payout wallet is captured on the account for the user's OWN future
// earnings, not for this charge.
import crypto from "node:crypto";

const ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/+$/, "");
const API_KEY = process.env.COINPAY_API_KEY || "";
const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID || "";
const WEBHOOK_SECRET = process.env.COINPAY_WEBHOOK_SECRET || "";
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
  const body: Record<string, unknown> = {
    amount: opts.amount || SETUP_FEE_USD,
    blockchain: PAY_CHAIN,
    description: `moshcoding account setup — ${opts.domain}`,
    metadata: { kind: "account_setup", account_id: opts.accountId, email: opts.email, domain: opts.domain },
  };
  if (opts.redirectUrl) body.redirect_url = opts.redirectUrl;
  if (BUSINESS_ID) body.business_id = BUSINESS_ID;

  const res = await fetch(`${ISSUER}/api/payments/create`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`coinpay create ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { payment?: { id?: string; status?: string } };
  const id = data.payment?.id;
  if (!id) throw new Error("coinpay: no payment id in response");
  return { id, status: data.payment?.status || "pending", payUrl: payUrl(id) };
}

/**
 * Verifies an "X-CoinPay-Signature: t=<ts>,v1=<hex>" header. HMAC-SHA256 over
 * "<ts>.<rawBody>" with the shared webhook secret, 5-minute timestamp tolerance,
 * constant-time compare. Returns false when no secret is configured.
 */
export function verifyWebhook(rawBody: string, sigHeader: string | null): boolean {
  if (!WEBHOOK_SECRET || !sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PAID = new Set(["confirmed", "forwarded", "completed"]);
/** CoinPay statuses that mean the money is in: confirmed/forwarded/completed. */
export function isPaidStatus(s: unknown): boolean {
  return typeof s === "string" && PAID.has(s.toLowerCase());
}

/** GET <ISSUER>/api/payments/<id> — poll fallback when a webhook is missed. */
export async function fetchPaymentStatus(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${ISSUER}/api/payments/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { payment?: { status?: string } };
    return data.payment?.status || null;
  } catch {
    return null;
  }
}
