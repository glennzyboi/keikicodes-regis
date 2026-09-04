"use client";

import { useState } from "react";

/**
 * Ask for a fresh portal link.
 *
 * In production this always answers the same way, whether or not the address is
 * on file, and the link goes to the inbox. Saying "no such parent" would turn
 * this box into a way of asking whether a given family uses Keiki Coders.
 *
 * This is a local trial build with no mail server, so the route also returns
 * the link for the demo. That behaviour is switched off when NODE_ENV is
 * production, in the route itself rather than here.
 */
export function FindLink() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [demoLink, setDemoLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/portal/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    setDemoLink(body.demoLink ?? null);
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="mt-8 rounded-2xl border border-hairline bg-paper p-6">
        <p className="font-display font-semibold text-green-900">Check your email</p>
        <p className="mt-2 text-sm text-ink-soft">
          If {email} is on file, a link is on its way. It works for thirty days.
        </p>
        {demoLink && (
          <div className="mt-4 border-t border-hairline pt-4">
            <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
              Trial build only
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              There is no mail server here, so the link is shown instead of sent.
            </p>
            <a href={demoLink} className="kc-btn kc-btn-primary mt-3 text-sm">
              Open my registrations
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-hairline bg-paper p-6">
      <label htmlFor="portal-email" className="kc-label">
        Email me a link
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          id="portal-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="kc-field flex-1"
        />
        <button className="kc-btn kc-btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Sending" : "Send link"}
        </button>
      </div>
    </form>
  );
}
