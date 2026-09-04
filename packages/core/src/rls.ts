import { sql } from "./db";
import type { TransactionSql } from "postgres";

/**
 * Run queries as a signed in user, with row level security applied.
 *
 * Everything else in this app connects as the database owner, which bypasses
 * RLS entirely. That is right for the registration path: it runs before anyone
 * has an identity, and its safety comes from constraints rather than policies.
 *
 * The admin is the opposite case. It has a real signed in human behind it, so
 * it reads through the same policies a Supabase client would, by setting the
 * role and the JWT claims that auth.uid() reads. If someone is removed from the
 * staff table, the admin stops returning rows on the next request, without a
 * single application level check to remember to write.
 *
 * SET LOCAL scopes both settings to this transaction, so a pooled connection
 * cannot leak one user's identity into the next request.
 */
export async function asUser<T>(
  authUserId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claims',
                               ${JSON.stringify({ sub: authUserId, role: "authenticated" })},
                               true)`;
    return fn(tx);
  }) as Promise<T>;
}
