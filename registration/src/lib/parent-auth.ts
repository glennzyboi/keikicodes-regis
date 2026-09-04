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
 * Three things this has to get right, all of which it got wrong first time.
 *
 * 1. A staff account is not a family. Both sides share one Supabase session, so
 *    a staff member who walks to /portal was being turned into a parent, which
 *    put the office email in the families list. They are told no instead.
 *
 * 2. The common path is a read. Looking up by auth_user_id first means an
 *    ordinary page view does not write to the database at all.
 *
 * 3. Two renders can race. The layout and the page both resolve the parent, so
 *    the insert has to survive losing that race: a unique violation means
 *    somebody else just created the row, which is a success, not an error.
 *    Previously it surfaced as a 500.
 */
export async function currentParent(): Promise<Parent | null> {
  const supabase = await supabaseParent();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  // Staff are not families. One session covers both sides of the app, so
  // without this the office account acquires a parents row by browsing.
  const [isStaff] = await sql<{ id: string }[]>`
    select id from staff where auth_user_id = ${user.id}`;
  if (isStaff) return null;

  const email = user.email.trim().toLowerCase();
  const name =
    (user.user_metadata?.full_name as string) ??
    (user.user_metadata?.name as string) ??
    email.split("@")[0];

  const existing = await findParent(user.id);
  if (existing) return existing;

  try {
    // Claim a record that already exists under this address, which is how a
    // family who registered before accounts keeps their history instead of
    // being split in two. coalesce refuses to steal one that already belongs
    // to a different account.
    await sql`
      insert into parents (auth_user_id, email, full_name)
      values (${user.id}, ${email}, ${name})
      on conflict (email) do update
        set auth_user_id = coalesce(parents.auth_user_id, excluded.auth_user_id)`;
  } catch {
    // Lost a race with another render, or the address belongs to a different
    // account. Both are answered by reading back what is actually there.
  }

  return findParent(user.id);
}

/** Read the parents row belonging to this auth user, or null. */
async function findParent(authUserId: string): Promise<Parent | null> {
  const [row] = await sql<
    { id: string; email: string; full_name: string; phone: string | null }[]
  >`select id, email, full_name, phone
      from parents where auth_user_id = ${authUserId}`;

  if (!row) return null;

  return {
    id: row.id,
    authUserId,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
  };
}

/** Is Google sign in configured on this deployment? */
export const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
