import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { resolveStaff, type StaffMember } from "@keiki/core/identity";

export type { StaffMember };

/**
 * Staff do get a password.
 *
 * Parents get one too now, but staff were never the argument: they see every
 * family's details, so the bar is a real account with a real session, and
 * Supabase Auth already does that properly. We store nothing ourselves beyond
 * the link between the auth user and a row in staff.
 *
 * This file is deliberately thin. It knows how a session arrives in a Next
 * request, and nothing else. Deciding whether that person is staff is
 * @keiki/core/identity, shared with the API service so the two front doors
 * cannot disagree about who is allowed in.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read only. The
            // session is refreshed in the Server Action instead.
          }
        },
      },
    },
  );
}

/**
 * The signed in staff member, or null.
 *
 * Wrapped in `cache()`, which is not an optimisation so much as a correctness
 * fix. `getUser()` is a **network call to the auth server** on every invocation,
 * and one console page asks this several times over: the proxy, the console
 * layout, a nested layout, and `readAsStaff` inside the page itself. Rendering
 * one class detail page was four round trips for one question.
 *
 * That is fine on its own and stops being fine at the scale the rail creates.
 * Next prefetches every link in the viewport, and the rail is eleven of them, so
 * moving around the console fires dozens of concurrent requests, each
 * multiplying itself by four against a single local auth container. Anything
 * that times out under that load comes back as "no user", which this side
 * cannot tell apart from "signed out", so it redirects to the login page. That
 * is the shape of "it keeps asking me to log in when I click between tabs".
 *
 * `cache()` is per request, not across requests, so this changes nothing about
 * who is allowed in: the answer is still recomputed for every incoming request,
 * just once instead of four times.
 */
export const currentStaff = cache(async (): Promise<StaffMember | null> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveStaff(user.id);
});

/**
 * The access token for the current session, for calling the API service.
 *
 * The API does not share our cookie. It takes the same Supabase JWT as a
 * bearer token and resolves identity from it through the same core module, so
 * a request crossing the boundary carries exactly the authority the caller
 * already had, and no more.
 */
export async function accessToken(): Promise<string | null> {
  const supabase = await supabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
