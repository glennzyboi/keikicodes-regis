import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

/**
 * One pooled client for the whole server. Next.js hot-reloads modules in dev, so
 * the client is cached on globalThis to avoid opening a new pool on every save.
 *
 * This connects as the database owner, which bypasses row level security. That is
 * correct and deliberate: RLS protects the browser, which only ever holds the anon
 * key. Everything in this app that writes goes through a server route, and those
 * routes do their own authorisation.
 */
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

/**
 * Twenty is right for one long lived server against its own Postgres. It is
 * wrong for a serverless deployment, where every warm instance holds its own
 * pool against a shared Supabase pooler and the ceiling is reached by having
 * many small pools rather than one big one. So it is a number, not a constant,
 * and production sets it low.
 *
 * `prepare: false` is not an optimisation. Supabase's transaction pooler hands
 * a different backend to each statement, so a named prepared statement made on
 * one is missing on the next. Without this, everything works locally and fails
 * intermittently the moment it is deployed behind the pooler.
 */
const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 20);

export const sql =
  globalForDb.sql ??
  postgres(connectionString, {
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 20,
    prepare: false,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

/**
 * There is deliberately no ORM layer and no second copy of the schema in
 * TypeScript. The migrations are the schema; a mirror of them in another
 * language is one more thing to get out of step, and it did get out of step the
 * moment holidays made `weeks` untrue. Every query in this codebase is SQL, and
 * every one of them is readable next to the table it reads.
 */
