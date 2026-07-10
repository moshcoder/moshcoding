// Password hashing with Node's built-in scrypt — no native dependency (keeps the
// Bun/Node build clean per the repo's "avoid native builds" rule). Stored as
// separate hex hash + salt columns; verify is constant-time.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  if (!password || !hash || !salt) return false;
  let derived: Buffer;
  try {
    derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  } catch {
    return false;
  }
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Minimum policy for a new password. Returns an error string, or null if OK. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}
