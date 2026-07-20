import crypto from "node:crypto";

// Header: "X-Moshcode-Signature: t=<ts>,v1=<hex>" over "<ts>.<rawBody>".
export function verifyMoshcodeSignature(rawBody: string, sig: string | null): boolean {
  const secret = process.env.MOSHCODE_WEBHOOK_SECRET || "";
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!sig) return false;

  const parts: Record<string, string> = {};
  for (const kv of sig.split(",")) {
    const i = kv.indexOf("=");
    if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }

  const { t, v1 } = parts;
  if (!t || !v1) return false;
  if (!/^\d+$/.test(t)) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  if (!/^[a-f0-9]{64}$/i.test(v1)) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
