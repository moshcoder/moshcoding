// Resend-backed transactional email for the waitlist double opt-in.
//
// We hit the Resend REST API directly with fetch (no SDK dependency). When
// RESEND_API_KEY is unset — e.g. local dev — isEmailConfigured() is false and
// callers fall back to auto-confirming so the flow still works offline.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** From address; override with RESEND_FROM. Must be a Resend-verified domain. */
function fromAddress(): string {
  return process.env.RESEND_FROM || "moshcoding <noreply@moshcoding.com>";
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || "https://moshcoding.com").replace(/\/+$/, "");
}

type SendResult = { ok: boolean; id?: string; error?: string };

/** Just the address part of RESEND_FROM (the verified sending mailbox). */
function sendingAddress(): string {
  const raw = process.env.RESEND_FROM || "moshcoding <noreply@moshcoding.com>";
  const m = raw.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return raw.includes("@") ? raw.trim() : "noreply@moshcoding.com";
}

/**
 * Branded From: the display name is the tenant brand, the mailbox stays on the
 * Resend-verified moshcoding.com domain (we can't send *from* a tenant's domain
 * unless it's verified). e.g. "Moshcode <noreply@moshcoding.com>".
 */
function brandedFrom(brand?: string): string {
  if (!brand) return fromAddress();
  const clean = brand.replace(/["<>]/g, "").trim().slice(0, 60) || "moshcoding";
  return `${clean} <${sendingAddress()}>`;
}

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from || fromAddress(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `resend ${res.status}: ${detail.slice(0, 300)}` };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: data.id };
}

/** Sends the "confirm your spot" email with a one-click verification link. */
export function sendWaitlistVerification(opts: {
  email: string;
  token: string;
  brand?: string;
}): Promise<SendResult> {
  const brand = opts.brand || "moshcoding";
  const url = `${appBaseUrl()}/api/waitlist/verify?token=${encodeURIComponent(opts.token)}`;
  const subject = `Confirm your spot in the ${brand} pit 🤘`;
  const text =
    `You're almost in. Confirm your email to lock in your spot on the ${brand} waitlist:\n\n` +
    `${url}\n\n` +
    `If you didn't request this, just ignore it — no account is created.`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#141416;border:1px solid #26262a;border-radius:12px;padding:28px">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;color:#9EF01A">${brand} 🤘</h1>
          <p style="margin:0 0 20px;line-height:1.5;color:#c9c9c9">
            You're almost in. Confirm your email to lock in your spot in the pit.
          </p>
          <p style="margin:0 0 24px">
            <a href="${url}" style="display:inline-block;background:#9EF01A;color:#0b0b0c;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">
              Confirm my spot
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#8a8a8a;line-height:1.5;word-break:break-all">
            Or paste this link:<br>${url}
          </p>
          <p style="margin:18px 0 0;font-size:12px;color:#6a6a6a">
            Didn't sign up? Ignore this — nothing happens.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return send({ to: opts.email, subject, html, text, from: brandedFrom(opts.brand) });
}

/** Notifies that a GitHub PR or issue was closed. */
export function sendGithubClosedNotification(opts: {
  to: string;
  kind: "pull request" | "issue";
  repo: string;
  number: number;
  title: string;
  url: string;
  actor: string;
  merged?: boolean;
}): Promise<SendResult> {
  const verb = opts.kind === "pull request" && opts.merged ? "merged" : "closed";
  const subject = `[${opts.repo}] ${opts.kind} #${opts.number} ${verb}: ${opts.title}`.slice(0, 180);
  const text =
    `${opts.actor} ${verb} ${opts.kind} #${opts.number} in ${opts.repo}\n\n` +
    `${opts.title}\n${opts.url}\n`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#141416;border:1px solid #26262a;border-radius:12px;padding:24px">
        <tr><td>
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a8a8a">${opts.repo}</p>
          <h1 style="margin:0 0 12px;font-size:18px;color:#9EF01A">${opts.kind} #${opts.number} ${verb} 🤘</h1>
          <p style="margin:0 0 16px;line-height:1.5;color:#d6d6d6">${opts.title}</p>
          <p style="margin:0 0 18px;font-size:13px;color:#9a9a9a">by ${opts.actor}</p>
          <a href="${opts.url}" style="display:inline-block;background:#9EF01A;color:#0b0b0c;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">View on GitHub</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return send({ to: opts.to, subject, html, text });
}

/** Sends a password-reset link. Caller falls back to logging the link if unsent. */
export function sendPasswordReset(opts: {
  email: string;
  token: string;
  brand?: string;
}): Promise<SendResult> {
  const brand = opts.brand || "moshcoding";
  const url = `${appBaseUrl()}/reset?token=${encodeURIComponent(opts.token)}`;
  const subject = `Reset your ${brand} password`;
  const text =
    `Someone asked to reset the password for your ${brand} account.\n\n` +
    `Set a new one here (link expires in 1 hour):\n${url}\n\n` +
    `If this wasn't you, ignore this email — your password stays unchanged.`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#0b0b0c;color:#e7e7e7;font-family:ui-monospace,Menlo,Consolas,monospace">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#141416;border:1px solid #26262a;border-radius:12px;padding:28px">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;color:#9EF01A">${brand} 🤘</h1>
          <p style="margin:0 0 20px;line-height:1.5;color:#c9c9c9">
            Reset your password. This link expires in 1 hour.
          </p>
          <p style="margin:0 0 24px">
            <a href="${url}" style="display:inline-block;background:#9EF01A;color:#0b0b0c;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">
              Set a new password
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#8a8a8a;line-height:1.5;word-break:break-all">
            Or paste this link:<br>${url}
          </p>
          <p style="margin:18px 0 0;font-size:12px;color:#6a6a6a">
            Didn't ask for this? Ignore it — nothing changes.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return send({ to: opts.email, subject, html, text });
}
