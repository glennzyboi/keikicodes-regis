import { sql } from "./db";

/**
 * Who is this Supabase auth user, in our terms?
 *
 * Supabase Auth answers "is this a real, signed in person". It cannot answer
 * "are they staff" or "which family are they", because that lives in our
 * tables. This module is the join between the two, and it deliberately knows
 * nothing about how the session arrived.
 *
 * That matters now there are two front doors. The web app reads a cookie
 * through next/headers; the API service reads a bearer token off an
 * Authorization header. Both end up holding the same thing, a Supabase user
 * id, and both need exactly the same answer from it. Keeping the lookup here
 * means the two doors cannot drift into disagreeing about who is allowed in,
 * which is the kind of bug that only shows up as a privilege hole.
 */

export type StaffMember = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
};

export type Parent = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
};

/**
 * The staff member behind this auth user, or null.
 *
 * Two checks, not one: a valid session proves who they are, and the staff row
 * proves they are allowed in. Someone who signs up through the parent form
 * holds a perfectly valid session and still gets nothing here.
 */
export async function resolveStaff(authUserId: string): Promise<StaffMember | null> {
  const [row] = await sql<{ id: string; email: string; full_name: string }[]>`
    select id, email, full_name from staff where auth_user_id = ${authUserId}`;
  if (!row) return null;
  return { id: row.id, authUserId, email: row.email, fullName: row.full_name };
}

/** Is this auth user a member of staff? Cheaper than resolving the whole row. */
export async function isStaff(authUserId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    select id from staff where auth_user_id = ${authUserId}`;
  return Boolean(row);
}

/** Read the parents row belonging to this auth user, or null. */
export async function findParent(authUserId: string): Promise<Parent | null> {
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

/**
 * The parent behind this auth user, creating the parents row on first sight.
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
export async function resolveParent(
  authUserId: string,
  identity: { email: string | null | undefined; name?: string | null },
): Promise<Parent | null> {
  if (!identity.email) return null;

  // Staff are not families. One session covers both sides of the app, so
  // without this the office account acquires a parents row by browsing.
  if (await isStaff(authUserId)) return null;

  const existing = await findParent(authUserId);
  if (existing) return existing;

  const email = identity.email.trim().toLowerCase();
  const name = identity.name?.trim() || email.split("@")[0];

  try {
    // Claim a record that already exists under this address, which is how a
    // family who registered before accounts keeps their history instead of
    // being split in two. coalesce refuses to steal one that already belongs
    // to a different account.
    await sql`
      insert into parents (auth_user_id, email, full_name)
      values (${authUserId}, ${email}, ${name})
      on conflict (email) do update
        set auth_user_id = coalesce(parents.auth_user_id, excluded.auth_user_id)`;
  } catch {
    // Lost a race with another render, or the address belongs to a different
    // account. Both are answered by reading back what is actually there.
  }

  return findParent(authUserId);
}
