import { formatMoney } from "./money";

/**
 * Message templates.
 *
 * Rendered from the frozen payload on the notification row, never from a fresh
 * query. A cancellation notice sent on Tuesday should still read the way it did
 * on Tuesday, even if the class has since been rescheduled twice.
 *
 * Every template returns HTML and a plain text alternative. The text version is
 * not an afterthought: it is what a watch, a screen reader and a spam filter
 * see first, and a message with no text part scores worse for deliverability.
 *
 * Deliberately hand written rather than a template engine. There are five
 * messages. A rendering dependency would be more code than the messages.
 */

export type TemplateName =
  | "registration_confirmed"
  | "session_cancelled"
  | "session_rescheduled"
  | "session_restored"
  | "session_added"
  | "sessions_shifted"
  | "class_reminder"
  | "cancellation_approved"
  | "schedule_changed";

export type Rendered = { subject: string; html: string; text: string };

const BRAND = {
  green: "#0f5740",
  greenMid: "#1b7a5a",
  ink: "#06231c",
  muted: "#4a5551",
  line: "#ebedee",
  paper: "#ffffff",
  wash: "#f4f7f5",
  sun: "#ffcf33",
};

function layout(opts: {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footnote?: string;
}) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.wash};">
  <!-- Preheader: the grey line a client shows next to the subject. Hidden in
       the message itself, so it does not read as a duplicate heading. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(opts.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.wash};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:${BRAND.paper};border:1px solid ${BRAND.line};border-radius:18px;overflow:hidden;">

        <tr><td style="padding:22px 28px 0;">
          <span style="display:inline-block;font:700 17px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.green};">
            Keiki Coders
          </span>
        </td></tr>

        <tr><td style="padding:18px 28px 0;">
          <h1 style="margin:0;font:700 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.green};">
            ${escape(opts.heading)}
          </h1>
        </td></tr>

        <tr><td style="padding:14px 28px 0;font:400 15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">
          ${opts.body}
        </td></tr>

        ${
          opts.cta
            ? `<tr><td style="padding:22px 28px 0;">
                 <a href="${escapeAttr(opts.cta.url)}"
                    style="display:inline-block;background:${BRAND.greenMid};color:#fff;text-decoration:none;
                           font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                           padding:13px 22px;border-radius:999px;">${escape(opts.cta.label)}</a>
               </td></tr>`
            : ""
        }

        <tr><td style="padding:26px 28px 24px;">
          <div style="border-top:1px solid ${BRAND.line};padding-top:14px;
                      font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};">
            ${opts.footnote ? `${escape(opts.footnote)}<br><br>` : ""}
            Keiki Coders, after school coding across Oahu.<br>
            This is a demonstration system built for a trial task and is not affiliated with Keiki Coders.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Untrusted values go through this. A child's name is user input. */
function escape(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: unknown) {
  return escape(s).replace(/'/g, "&#39;");
}

function rows(pairs: [string, string][]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;width:100%;">
    ${pairs
      .map(
        ([k, v]) => `<tr>
          <td style="padding:5px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};width:40%;">${escape(k)}</td>
          <td style="padding:5px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">${escape(v)}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

export type Payload = Record<string, unknown>;

/**
 * Render a message. Unknown template names throw rather than sending something
 * blank: a message with no content is worse than a message that failed.
 */
export function render(template: TemplateName, p: Payload): Rendered {
  const appUrl = (p.appUrl as string) ?? process.env.APP_URL ?? "http://localhost:3000";
  const portal = `${appUrl}/dashboard`;

  switch (template) {
    case "registration_confirmed": {
      const children = (p.children as string[]) ?? [];
      const subject = `You are registered for ${p.className}`;
      return {
        subject,
        html: layout({
          preheader: `${children.join(" and ")} confirmed for ${p.className}.`,
          heading: "Your keiki are in",
          body: `<p style="margin:0;">Thank you, ${escape(p.parentName)}. Payment went through and the place is confirmed.</p>
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Children", children.join(", ")],
                   ["Schedule", String(p.schedule)],
                   ["First session", String(p.firstSession)],
                   ["Paid", formatMoney(Number(p.amountCents ?? 0))],
                 ])}`,
          cta: { label: "View my registrations", url: portal },
          footnote: "Need to change something? Sign in and request a cancellation, and the office will be in touch.",
        }),
        text: [
          `Thank you, ${p.parentName}. Payment went through and the place is confirmed.`,
          ``,
          `Class: ${p.className}`,
          `Campus: ${p.school}`,
          `Children: ${children.join(", ")}`,
          `Schedule: ${p.schedule}`,
          `First session: ${p.firstSession}`,
          `Paid: ${formatMoney(Number(p.amountCents ?? 0))}`,
          ``,
          `View your registrations: ${portal}`,
        ].join("\n"),
      };
    }

    case "session_cancelled": {
      const subject = `Cancelled: ${p.className} on ${p.sessionDate}`;
      return {
        subject,
        html: layout({
          preheader: `No ${p.className} on ${p.sessionDate}.`,
          heading: "A class is cancelled",
          body: `<p style="margin:0;">There will be no ${escape(p.className)} on ${escape(p.sessionDate)}. Every other session runs as normal and your place is unaffected.</p>
                 ${p.note ? `<p style="margin:14px 0 0;padding:12px 14px;background:${BRAND.wash};border-radius:10px;">${escape(p.note)}</p>` : ""}
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Cancelled date", String(p.sessionDate)],
                   ["Next session", String(p.nextSession ?? "To be confirmed")],
                 ])}`,
          cta: { label: "See my registrations", url: portal },
        }),
        text: [
          `There will be no ${p.className} on ${p.sessionDate}.`,
          p.note ? `\n${p.note}` : "",
          ``,
          `Campus: ${p.school}`,
          `Next session: ${p.nextSession ?? "to be confirmed"}`,
          ``,
          `Your place is unaffected. ${portal}`,
        ].join("\n"),
      };
    }

    case "session_rescheduled": {
      const subject = `Moved: ${p.className} is now ${p.newDate}`;
      // The office can now change the time as well as the date, so this line
      // has to be told which happened. It used to say "same time, same room"
      // unconditionally, which would have been a lie the first time somebody
      // moved a 3pm class to a 9am Saturday.
      const sameTime = p.timeChanged ? "Note the new time." : "Same time, same room.";
      return {
        subject,
        html: layout({
          preheader: `${p.className} moves from ${p.oldDate} to ${p.newDate}.`,
          heading: "A class has moved",
          body: `<p style="margin:0;">The ${escape(p.className)} session on ${escape(p.oldDate)} has moved to ${escape(p.newDate)}. ${escape(sameTime)}</p>
                 ${p.note ? `<p style="margin:14px 0 0;padding:12px 14px;background:${BRAND.wash};border-radius:10px;">${escape(p.note)}</p>` : ""}
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Was", String(p.oldDate)],
                   ["Now", String(p.newDate)],
                 ])}`,
          cta: { label: "See my registrations", url: portal },
        }),
        text: [
          `The ${p.className} session on ${p.oldDate} has moved to ${p.newDate}. ${sameTime}`,
          p.note ? `\n${p.note}` : "",
          ``,
          `Campus: ${p.school}`,
          ``,
          portal,
        ].join("\n"),
      };
    }

    case "session_restored": {
      // A cancellation put back. Worth its own message rather than silence:
      // a family told on Monday that Tuesday is off will not turn up on
      // Tuesday unless somebody tells them it is on again.
      const subject = `Back on: ${p.className} on ${p.sessionDate}`;
      return {
        subject,
        html: layout({
          preheader: `${p.className} on ${p.sessionDate} is running after all.`,
          heading: "That class is running after all",
          body: `<p style="margin:0;">${escape(p.className)} on ${escape(p.sessionDate)} is back on. We are sorry for the change about.</p>
                 ${p.note ? `<p style="margin:14px 0 0;padding:12px 14px;background:${BRAND.wash};border-radius:10px;">${escape(p.note)}</p>` : ""}
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Date", String(p.sessionDate)],
                 ])}`,
          cta: { label: "See my registrations", url: portal },
        }),
        text: [
          `${p.className} on ${p.sessionDate} is back on. We are sorry for the change about.`,
          p.note ? `\n${p.note}` : "",
          ``,
          `Campus: ${p.school}`,
          ``,
          portal,
        ].join("\n"),
      };
    }

    case "session_added": {
      const subject = `Extra class: ${p.className} on ${p.sessionDate}`;
      return {
        subject,
        html: layout({
          preheader: `An extra ${p.className} session on ${p.sessionDate}.`,
          heading: "An extra session",
          body: `<p style="margin:0;">We have added a session of ${escape(p.className)} on ${escape(p.sessionDate)}. Your place covers it; there is nothing to pay and nothing to do.</p>
                 ${p.note ? `<p style="margin:14px 0 0;padding:12px 14px;background:${BRAND.wash};border-radius:10px;">${escape(p.note)}</p>` : ""}
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Date", String(p.sessionDate)],
                 ])}`,
          cta: { label: "See my registrations", url: portal },
        }),
        text: [
          `We have added a session of ${p.className} on ${p.sessionDate}.`,
          `Your place covers it; there is nothing to pay and nothing to do.`,
          p.note ? `\n${p.note}` : "",
          ``,
          `Campus: ${p.school}`,
          ``,
          portal,
        ].join("\n"),
      };
    }

    case "sessions_shifted": {
      // Several dates moved together, which is what a term slipping actually
      // looks like. One message, not one per date: a family whose last four
      // weeks moved does not want four emails saying the same thing.
      const subject = `${p.className}: some dates have moved`;
      return {
        subject,
        html: layout({
          preheader: `${p.summary} for ${p.className}.`,
          heading: "Some dates have moved",
          body: `<p style="margin:0;">${escape(String(p.summary))} for ${escape(p.className)}. Your place is unaffected and there is nothing to do.</p>
                 ${p.note ? `<p style="margin:14px 0 0;padding:12px 14px;background:${BRAND.wash};border-radius:10px;">${escape(p.note)}</p>` : ""}
                 ${rows([
                   ["Class", String(p.className)],
                   ["Campus", String(p.school)],
                   ["Change", String(p.summary)],
                 ])}
                 <p style="margin:14px 0 0;">Your registration page has the full list of dates.</p>`,
          cta: { label: "See the new dates", url: portal },
        }),
        text: [
          `${p.summary} for ${p.className}. Your place is unaffected and there is nothing to do.`,
          p.note ? `\n${p.note}` : "",
          ``,
          `Campus: ${p.school}`,
          ``,
          `The full list of dates is on your registration page: ${portal}`,
        ].join("\n"),
      };
    }

    case "schedule_changed": {
      // Sent when the office moves a whole class, not one session. Their system
      // has no way to do this at all: a schedule change today means somebody
      // remembering to email everybody by hand, which is exactly the sort of
      // job that gets half done on a Friday.
      const subject = `${p.className} has a new schedule`;
      return {
        subject,
        html: layout({
          preheader: `${p.className} now runs ${p.schedule}.`,
          heading: "The schedule has changed",
          body: `<p style="margin:0;">We have changed when ${escape(p.className)} runs. ${escape(String(p.childName))} is still registered; nothing needs doing.</p>
                 ${rows([
                   ["Class", String(p.className)],
                   ["Now runs", String(p.schedule)],
                   ["First session", String(p.firstSession)],
                   ["Last session", String(p.lastSession)],
                 ])}
                 <p style="margin:14px 0 0;">Your registration page has the full list of dates, holidays included.</p>`,
          cta: { label: "See the new dates", url: portal },
        }),
        text: [
          `We have changed when ${p.className} runs. ${p.childName} is still registered; nothing needs doing.`,
          ``,
          `Now runs: ${p.schedule}`,
          `First session: ${p.firstSession}`,
          `Last session: ${p.lastSession}`,
          ``,
          `The full list of dates, holidays included, is on your registration page.`,
          ``,
          portal,
        ].join("\n"),
      };
    }

    case "class_reminder": {
      const subject = `Today: ${p.className} at ${p.startTime}`;
      return {
        subject,
        html: layout({
          preheader: `${p.childName} has ${p.className} today at ${p.startTime}.`,
          heading: "Class is today",
          body: `<p style="margin:0;">${escape(p.childName)} has ${escape(p.className)} today, straight after school.</p>
                 ${rows([
                   ["Time", `${p.startTime} to ${p.endTime}`],
                   ["Campus", String(p.school)],
                   ["Session", `${p.sessionNumber} of ${p.sessionTotal}`],
                 ])}`,
          footnote: "Nothing to bring. Everything is supplied.",
        }),
        text: [
          `${p.childName} has ${p.className} today, straight after school.`,
          ``,
          `Time: ${p.startTime} to ${p.endTime}`,
          `Campus: ${p.school}`,
          `Session ${p.sessionNumber} of ${p.sessionTotal}`,
          ``,
          `Nothing to bring. Everything is supplied.`,
        ].join("\n"),
      };
    }

    case "cancellation_approved": {
      const refunded = Number(p.refundCents ?? 0);
      const subject = `Cancelled: ${p.childName} in ${p.className}`;
      return {
        subject,
        html: layout({
          preheader:
            refunded > 0
              ? `${formatMoney(refunded)} is on its way back to your card.`
              : `The place has been released.`,
          heading: "Your cancellation is confirmed",
          body: `<p style="margin:0;">${escape(p.childName)} has been taken off ${escape(p.className)} and the place is released.</p>
                 ${rows(
                   refunded > 0
                     ? [
                         ["Refunded", formatMoney(refunded)],
                         ["Back on your card", "Five to ten business days"],
                         ["Originally paid", formatMoney(Number(p.paidCents ?? 0))],
                       ]
                     : [["Refund", "None, as agreed with the office"]],
                 )}`,
          footnote:
            refunded > 0
              ? "Refunds are returned to the card that paid. Your bank decides exactly when it appears."
              : undefined,
        }),
        text: [
          `${p.childName} has been taken off ${p.className} and the place is released.`,
          ``,
          refunded > 0
            ? `Refunded: ${formatMoney(refunded)}, back on the card that paid within five to ten business days.`
            : `No refund, as agreed with the office.`,
        ].join("\n"),
      };
    }
  }
}
