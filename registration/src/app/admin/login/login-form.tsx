"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function LoginForm() {
  const [error, formAction, pending] = useActionState(signIn, null);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="ops-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="ops-field w-full"
        />
      </div>

      <div>
        <label htmlFor="password" className="ops-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="ops-field w-full"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-[var(--ops-danger-soft)] px-3 py-2 text-[var(--ops-danger)]">
          {error}
        </p>
      )}

      <button className="ops-btn ops-btn-primary w-full" disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
