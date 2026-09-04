import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sql } from "./db";

/**
 * Staff do get a password.
 *
 * Parents do not, because a login wall in front of the money costs
 * registrations. Staff are different: they see every family's details, so the
 * bar is a real account with a real session, and Supabase Auth already does
 * that properly. We store nothing ourselves beyond the link between the auth
 * user and a row in staff.
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

export type StaffMember = { id: string; authUserId: string; email: string; fullName: string };

/**
 * The signed in staff member, or null.
 *
 * Two checks, not one: a valid Supabase session proves who they are, and the
 * staff row proves they are allowed in. Someone who signs up through any other
 * route holds a perfectly valid session and still gets nothing.
 */
export async function currentStaff(): Promise<StaffMember | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [row] = await sql<{ id: string; email: string; full_name: string }[]>`
    select id, email, full_name from staff where auth_user_id = ${user.id}`;
  if (!row) return null;

  return { id: row.id, authUserId: user.id, email: row.email, fullName: row.full_name };
}
