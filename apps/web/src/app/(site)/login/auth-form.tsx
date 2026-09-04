"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { signIn, signUp, type AuthState } from "../account/actions";

/**
 * One form, two modes.
 *
 * Sign in and create an account are the same three fields plus a name, and a
 * parent arriving from a class link does not care which one they need. Putting
 * them on one screen means nobody bounces between two pages guessing whether
 * they registered last term.
 */
export function AuthForm({
  mode,
  next,
  googleEnabled,
}: {
  mode: "signin" | "signup";
  next: string;
  googleEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    mode === "signin" ? signIn : signUp,
    { error: null },
  );
  const [googleBusy, setGoogleBusy] = useState(false);

  async function withGoogle() {
    setGoogleBusy(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <div className="mt-8">
      {googleEnabled && (
        <>
          <button onClick={withGoogle} disabled={googleBusy} className="kc-btn kc-btn-quiet w-full">
            <GoogleMark />
            {googleBusy ? "Opening Google" : "Continue with Google"}
          </button>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
              or
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
        </>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        {mode === "signup" && (
          <div>
            <label htmlFor="fullName" className="kc-label">
              Your name
            </label>
            <input
              id="fullName"
              name="fullName"
              className="kc-field"
              required
              autoComplete="name"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="kc-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="kc-field"
            required
            autoComplete="email"
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
            className="kc-field"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          {mode === "signup" && (
            <p className="mt-1.5 text-xs text-ink-soft">At least eight characters.</p>
          )}
        </div>

        {state.error && (
          <p role="alert" className="kc-alert">
            {state.error}
          </p>
        )}

        <button className="kc-btn kc-btn-primary w-full" disabled={pending}>
          {pending
            ? mode === "signin"
              ? "Signing in"
              : "Creating your account"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {mode === "signin" ? (
          <>
            New to Keiki Coders?{" "}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="font-semibold text-green-700 underline decoration-green-200 underline-offset-4"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already registered before?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="font-semibold text-green-700 underline decoration-green-200 underline-offset-4"
            >
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.6h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.6c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.8C7.9 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 28c-.4-1.3-.7-2.6-.7-4s.3-2.7.7-4v-5.8H4.3A22 22 0 0 0 2 24c0 3.6.9 6.9 2.3 9.8L11.6 28z"
      />
      <path
        fill="#EA4335"
        d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 3.9 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.8c1.7-5.2 6.6-9.6 12.4-9.6z"
      />
    </svg>
  );
}
