/**
 * Sending email.
 *
 * Three transports behind one interface, chosen by environment. Mailpit, which
 * ships with the local Supabase stack, for development; SMTP for the hosted
 * prototype, because a Gmail app password is something you already have and a
 * Resend account is something you would have to go and open; Resend for real
 * production, where you want a sending domain and delivery reporting rather
 * than somebody's mailbox.
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

const FROM_EMAIL = process.env.EMAIL_FROM ?? "hello@keikicoders.com";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Keiki Coders";

/**
 * The demo stop.
 *
 * The prototype is seeded with thirty six believable families, and believable
 * means addresses like malia.kealoha@gmail.com — addresses that may well belong
 * to somebody. So DEMO_DATA=1 guarantees no seeded family is ever written to.
 *
 * It does that in one of two ways, and the difference matters.
 *
 * With DEMO_MAIL_TO set, every message is *redirected* to that one address,
 * with the intended recipient moved into the subject line and repeated at the
 * top of the body. This is the useful mode: a walkthrough shows real
 * confirmations arriving in a real inbox, delivery is genuinely exercised
 * end to end, and the only mailbox involved belongs to whoever is running the
 * demo. It is the same idea as a catch-all mail trap, done at the last possible
 * moment so nothing upstream has to know.
 *
 * Without it, delivery is refused outright, because silently delivering to the
 * seed would be the one unrecoverable mistake here. The refusal is a returned
 * failure rather than a throw: the worker records the reason against the
 * message, the Outbox shows exactly why it did not go, and one badly addressed
 * batch cannot take the cron down.
 *
 * Clear DEMO_DATA when the database holds real people. That is the whole
 * switch, and it is deliberately not the same switch as "have we got a mail
 * provider yet".
 */
class DemoRedirectTransport implements EmailTransport {
  readonly name: string;
  constructor(
    private inner: EmailTransport,
    private sink: string,
  ) {
    this.name = `${inner.name}→demo`;
  }

  async send(message: Outbound): Promise<SendResult> {
    const note =
      `This is a demonstration message. It was addressed to ${message.to}` +
      `${message.toName ? ` (${message.toName})` : ""} and redirected here ` +
      `because DEMO_DATA is set.`;

    return this.inner.send({
      to: this.sink,
      toName: "Demo inbox",
      subject: `[demo → ${message.to}] ${message.subject}`,
      html:
        `<p style="margin:0 0 16px;padding:12px;background:#fff4d6;` +
        `border:1px solid #e6c86a;border-radius:6px;font:13px system-ui">` +
        `${note}</p>${message.html}`,
      text: `${note}\n\n---\n\n${message.text}`,
    });
  }
}

class DemoBlockedTransport implements EmailTransport {
  readonly name = "demo-blocked";
  async send(message: Outbound): Promise<SendResult> {
    return {
      ok: false,
      error:
        `refused: DEMO_DATA=1 and DEMO_MAIL_TO is not set, so ${message.to} ` +
        "was not written to. This database holds seeded families with realistic addresses.",
    };
  }
}

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
 * SMTP, which for this deployment means Gmail with an app password.
 *
 * Chosen over opening a Resend account because the credential already exists
 * and needs no domain verification, which is the slow part of standing up
 * transactional mail. The trade is real and worth stating: Gmail rate limits
 * hard, it rewrites the From header to the authenticated mailbox, and it gives
 * you no delivery reporting. That is fine for a prototype somebody is watching
 * and wrong for a school year of confirmations, which is why Resend is still
 * here and still the answer for production.
 *
 * nodemailer is imported lazily so that the two HTTP transports, and every
 * environment that uses them, carry no dependency on it at all.
 */
class SmtpTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: unknown;

  constructor(
    private opts: { host: string; port: number; user: string; pass: string; secure: boolean },
  ) {}

  private async client() {
    if (!this.transporter) {
      const nodemailer = await import("nodemailer");
      this.transporter = nodemailer.createTransport({
        host: this.opts.host,
        port: this.opts.port,
        secure: this.opts.secure,
        auth: { user: this.opts.user, pass: this.opts.pass },
      });
    }
    return this.transporter as {
      sendMail(m: Record<string, unknown>): Promise<{ messageId?: string }>;
    };
  }

  async send(message: Outbound): Promise<SendResult> {
    try {
      const client = await this.client();
      const info = await client.sendMail({
        // Gmail overwrites From with the authenticated mailbox unless the
        // address is a verified alias, so the display name is what actually
        // survives. Reply-To is set separately and does survive, which is the
        // part that matters to a parent hitting reply.
        from: `${FROM_NAME} <${this.opts.user}>`,
        replyTo: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: message.toName ? `${message.toName} <${message.to}>` : message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { ok: true, id: info.messageId ?? "unknown" };
    } catch (e) {
      // Retryable, like every other transport here: the worker decides.
      return { ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Explicit beats clever: EMAIL_TRANSPORT decides. Falling back to Mailpit when
 * nothing is configured means a missing provider in production is loud (mail
 * visibly failing to a localhost address) rather than quiet.
 */
function chooseTransport(): EmailTransport {
  const choice = process.env.EMAIL_TRANSPORT;
  const key = process.env.RESEND_API_KEY;

  if (choice === "resend" || (!choice && key)) {
    if (!key) throw new Error("EMAIL_TRANSPORT=resend but RESEND_API_KEY is not set");
    return new ResendTransport(key);
  }

  if (choice === "smtp") {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      throw new Error("EMAIL_TRANSPORT=smtp but SMTP_USER or SMTP_PASS is not set");
    }
    const port = Number(process.env.SMTP_PORT ?? 465);
    return new SmtpTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      user,
      pass,
      // 465 is implicit TLS; 587 is STARTTLS, which nodemailer negotiates when
      // told the socket does not start secure. Getting this backwards is the
      // usual reason an SMTP integration hangs rather than fails.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    });
  }

  return new MailpitTransport(process.env.MAILPIT_URL ?? "http://127.0.0.1:55324");
}

export function emailTransport(): EmailTransport {
  const inner = chooseTransport();

  // Last, and wrapping everything, so no route to a real send can skip it.
  if (process.env.DEMO_DATA === "1") {
    const sink = process.env.DEMO_MAIL_TO?.trim();
    return sink ? new DemoRedirectTransport(inner, sink) : new DemoBlockedTransport();
  }

  return inner;
}
