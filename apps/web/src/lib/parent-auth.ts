import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { resolveParent, type Parent } from "@keiki/core/identity";

export type { Parent };

/**
 * Parent accounts.
 *
 * The first cut had no parent login at all: guest checkout, then an HMAC signed
 * link in the confirmation email. That is better for conversion, and it is how
 * plenty of registration systems work, but the link IS the credential. Anyone
 * holding the email holds the account, forwarded mail included, and a family
 * inbox is one address with several people behind it.
 *
 * This system stores children's names, grades, photographs and medical notes.
 * For that, a real account is the right trade, and it is what makes the rest of
 * the product possible: a parent who is signed in can be shown their whole
 * family across terms rather than whatever one link happened to cover. It is
 * also what lets us stop asking them for the same details every single term,
 * which is what their current form does.
 *
 * Supabase Auth does the credential handling. The join to our own parents row
 * lives in @keiki/core/identity, shared with the API service.
 */
export async function supabaseParent() {
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
            // Read only in a Server Component. Refresh happens in the action or
            // the route handler that actually owns the response.
          }
        },
      },
    },
  );
}

/**
 * The signed in parent, creating the parents row on first sight.
 *
 * Deduplicated per request for the same reason as the staff side: `getUser()`
 * is a network call to the auth server, the dashboard asks this from a layout
 * and again from the page inside it, and every one of those is a round trip
 * that can time out under load and come back indistinguishable from "signed
 * out". Per request, so nothing is cached across people.
 */
export const currentParent = cache(async (): Promise<Parent | null> => {
  const supabase = await supabaseParent();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return resolveParent(user.id, {
    email: user.email,
    name:
      (user.user_metadata?.full_name as string) ?? (user.user_metadata?.name as string) ?? null,
  });
});

/** Is Google sign in configured on this deployment? */
export const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
