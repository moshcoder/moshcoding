/**
 * The pre-hub sender (lib/webhook-signing.ts) used the whole secret string,
 * `whsec_` included, as the HMAC key. @profullstack/webhooks reads a `whsec_`
 * secret the Standard Webhooks way: the key is the base64 after the prefix.
 * Wrapping the old string's bytes in base64 gives the hub the very same key,
 * so a receiver holding the old secret still verifies every delivery, and the
 * new form also works with any Standard Webhooks library.
 */
export function legacySecretToSpec(secret: string): string {
  return "whsec_" + Buffer.from(secret, "utf8").toString("base64");
}
