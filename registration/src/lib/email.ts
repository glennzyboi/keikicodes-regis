/**
 * Sending email.
 *
 * Two transports behind one interface, chosen by environment. Resend in
 * production; Mailpit, which is already part of the local Supabase stack, in
 * development. Both are plain HTTP, so there is no SMTP library and no SDK to
 * keep current, and the local path means a walkthrough can show real messages
 * arriving in a real inbox without sending anything to a real person.
 *
 * Nothing calls this directly from a request handler. Messages are written to
 * the notifications table inside the transaction that caused them, and the
 * worker in scripts/notify.ts is the only caller. See the outbox migration for
 * why that ordering matters.
 */

export type Outbound = {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export interface EmailTransport {
  readonly name: string;
  send(message: Outbound): Promise<SendResult>;
}

const FROM_EMAIL = process.env.EMAIL_FROM ?? "hello@keikicoders.test";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Keiki Coders";

/** Production. https://resend.com/docs/api-reference/emails/send-email */
class ResendTransport implements EmailTransport {
  readonly name = "resend";
  constructor(private apiKey: string) {}

  async send(message: Outbound): Promise<SendResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };

      if (!res.ok) {
        return { ok: false, error: body.message ?? `resend responded ${res.status}` };
      }
      return { ok: true, id: body.id ?? "unknown" };
    } catch (e) {
      // A network failure is retryable, so it comes back as a failed result
      // rather than a throw. The worker decides whether to try again.
      return { ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Development. Mailpit ships with the local Supabase stack and exposes an HTTP
 * send endpoint, so mail lands in a browsable inbox at its web UI and never
 * leaves the machine.
 */
class MailpitTransport implements EmailTransport {
  readonly name = "mailpit";
  constructor(private baseUrl: string) {}

  async send(message: Outbound): Promise<SendResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: message.to, Name: message.toName ?? undefined }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
        }),
      });

      if (!res.ok) {
        return { ok: false, error: `mailpit responded ${res.status}` };
      }
      const body = (await res.json().catch(() => ({}))) as { ID?: string };
      return { ok: true, id: body.ID ?? "unknown" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Explicit beats clever: EMAIL_TRANSPORT decides. Falling back to Mailpit when
 * no Resend key is present means a missing key in production is loud (mail
 * silently going nowhere) rather than quiet, so production must set it.
 */
export function emailTransport(): EmailTransport {
  const choice = process.env.EMAIL_TRANSPORT;
  const key = process.env.RESEND_API_KEY;

  if (choice === "resend" || (!choice && key)) {
    if (!key) throw new Error("EMAIL_TRANSPORT=resend but RESEND_API_KEY is not set");
    return new ResendTransport(key);
  }

  return new MailpitTransport(process.env.MAILPIT_URL ?? "http://127.0.0.1:55324");
}
