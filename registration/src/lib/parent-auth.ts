import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sql } from "./db";

/**
 * Parent accounts.
 *
 * The first cut had no parent login at all: guest checkout, then an HMAC signed
 * link in the confirmation email. That is better for conversion, and it is how
 * plenty of registration systems work, but the link IS the credential. Anyone
 * holding the email holds the account, forwarded mail included, and a family
 * inbox is one address with several people behind it.
 *
 * This system stores children's names, dates of birth and medical notes. For
 * that, a real account is the right trade, and it is what makes the rest of the
 * product possible: a parent who is signed in can be shown their whole family
 * across terms rather than whatever one link happened to cover.
 *
 * Supabase Auth does the credential handling. We keep the join to our own
 * parents row, and nothing else.
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

export type Parent = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
};

/**
 * The signed in parent, creating the parents row on first sight.
 *
 * Someone can exist in Supabase Auth without existing here: they signed up with
 * Google and have not registered anyone yet. Rather than scatter "have they got
 * a row yet" checks through the app, the row is created the first time we see
 * them, keyed on the auth user id.
 *
 * The email conflict branch matters. A family may already exist in our records
 * from before accounts, or from a guest registration, and the natural key for a
 * person is their email address. Signing up with that address should claim that
 * record rather than create a second one, which would split a family in two.
 */
export async function currentParent(): Promise<Parent | null> {
  const supabase = await supabaseParent();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const email = user.email.trim().toLowerCase();
  const name =
    (user.user_metadata?.full_name as string) ??
    (user.user_metadata?.name as string) ??
    email.split("@")[0];

  const [row] = await sql<
    { id: string; email: string; full_name: string; phone: string | null }[]
  >`
    insert into parents (auth_user_id, email, full_name)
    values (${user.id}, ${email}, ${name})
    on conflict (email) do update
      set auth_user_id = coalesce(parents.auth_user_id, excluded.auth_user_id)
    returning id, email, full_name, phone`;

  // The coalesce above refuses to steal a record that already belongs to a
  // different account. If that happened, this is not their family.
  const [check] = await sql<{ auth_user_id: string | null }[]>`
    select auth_user_id from parents where id = ${row.id}`;
  if (check.auth_user_id !== user.id) return null;

  return {
    id: row.id,
    authUserId: user.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
  };
}

/** Is Google sign in configured on this deployment? */
export const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
