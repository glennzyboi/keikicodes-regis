"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function LoginForm() {
  const [error, formAction, pending] = useActionState(signIn, null);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="kc-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="kc-field"
        />
      </div>

      <div>
        <label htmlFor="password" className="kc-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="kc-field"
        />
      </div>

      {error && (
        <p role="alert" className="kc-alert">
          {error}
        </p>
      )}

      <button className="kc-btn kc-btn-primary w-full" disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
