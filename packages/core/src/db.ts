import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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

export const sql =
  globalForDb.sql ??
  postgres(connectionString, {
    max: 20,
    prepare: false,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
