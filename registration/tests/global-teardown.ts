import { sql } from "./helpers";

/**
 * Close the shared database client once, after every spec file has finished.
 *
 * Each file used to close it in its own afterAll, which tore the pool out from
 * under the files that had not run yet.
 */
export default async function globalTeardown() {
  await sql.end({ timeout: 5 });
}
