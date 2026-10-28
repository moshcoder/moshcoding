// Runs once when the Next server boots. Starts the webhook drainer: queued
// deliveries are sent every few seconds and retried with backoff, and they
// survive restarts because the queue is in the database.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const env = (name: string) => process.env[name] ?? "";
  if (!env("DATABASE_URL") && !env("TURSO_DATABASE_URL")) return;
  const { hooks } = await import("./lib/webhooks");
  hooks().start();
}
