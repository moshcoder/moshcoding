import crypto from "node:crypto";

const TOLERANCE = 300; // seconds

/* ---- Standard Webhooks signing (interoperates with coinpay/crawlproof) ---- */
export function signWebhook(id: string, tsSec: number, body: string, secret: string) {
  const mac = crypto.createHmac("sha256", secret).update(`${id}.${tsSec}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(tsSec),
    "webhook-signature": `v1,${mac}`,
  };
}

export function verifyWebhook(headers: Record<string, string | null | undefined>, body: string, secret: string): boolean {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
  if (!id || !ts || !sig) return false;
  if (!/^\d+$/.test(String(ts))) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > TOLERANCE) return false;
  const expected = `v1,${crypto.createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const expectedBytes = Buffer.from(expected);
  return String(sig)
    .split(/\s+/)
    .filter(Boolean)
    .some((candidate) => {
      const candidateBytes = Buffer.from(candidate.trim());
      return candidateBytes.length === expectedBytes.length && crypto.timingSafeEqual(candidateBytes, expectedBytes);
    });
}

export function newSecret(prefix = "whsec_") {
  return prefix + crypto.randomBytes(24).toString("base64url");
}
