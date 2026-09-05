"use client";

import { useActionState, useState } from "react";
import { signIn } from "@/app/admin/actions";
import { Icon } from "@/app/admin/ui";

export function LoginForm() {
  const [error, formAction, pending] = useActionState(signIn, null);
  const [show, setShow] = useState(false);

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <div>
        <label htmlFor="email" className="ops-label">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          placeholder="you@keikicoders.com"
          className="ops-field w-full"
        />
      </div>

      <div>
        <label htmlFor="password" className="ops-label">
          Password
        </label>
        {/*
          A reveal toggle, because the alternative is people typing their
          password into the email box to check it. It is a button rather than a
          checkbox so it never submits, and it says which state it will move to
          rather than which state it is in.
        */}
        <div className="ops-field-wrap">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            className="ops-field w-full pr-16"
          />
          <button
            type="button"
            className="ops-reveal"
            onClick={() => setShow((s) => !s)}
            aria-pressed={show}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {/*
        The alert is the paragraph itself, not a wrapper around it.
        `role="alert"` on a container that is usually empty announces nothing
        useful, and more practically: the message is what anybody looking for
        this will target, and putting the role a level up broke every existing
        test that asserted on the wording of a refused sign in. Announced either
        way; this way it is also findable.
      */}
      {error && (
        <p role="alert" className="ops-note ops-note-bad flex items-start gap-2">
          <span className="mt-px shrink-0" aria-hidden>
            <Icon name="warning" size={14} />
          </span>
          {error}
        </p>
      )}

      <button className="ops-btn ops-btn-primary w-full justify-center" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-[var(--ops-faint)]">
        Locked out? Anyone else with a staff account can reset it for you from
        Supabase; there is no self serve reset on purpose, because the address
        that would receive it is the one being claimed.
      </p>
    </form>
  );
}
