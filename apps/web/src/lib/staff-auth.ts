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

/** The signed in staff member, or null. */
export async function currentStaff(): Promise<StaffMember | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveStaff(user.id);
}

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
