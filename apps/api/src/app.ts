import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sql } from "@keiki/core/db";

/**
 * The API service.
 *
 * Built as a value rather than started here, so tests and the job runner can
 * import the app without binding a port. `index.ts` is the only thing that
 * listens.
 *
 * What lives behind this boundary, and why:
 *
 *   - Stripe. One process holds the secret key and one process verifies webhook
 *     signatures. The web app has no way to charge anybody.
 *   - The public catalogue. Their Squarespace page currently reads two n8n
 *     webhooks; these endpoints answer in the same shape, so the migration is a
 *     URL change rather than a rewrite of their site.
 *   - The background jobs. Notifications, reminders and the seat sweeper are
 *     the same code the CLI runs, scheduled by the host rather than by us.
 *
 * Reads for the parent site and the office console are still server rendered
 * straight from the database under row level security, which is why the web
 * app keeps a connection string. Moving those behind HTTP too is a day of
 * fetchers with no user visible change, and it is written down as the next
 * step rather than half done.
 */
export function createApp() {
  const app = new Hono();

  app.use("*", logger());

  // The catalogue is read by their Squarespace site from a different origin.
  // Everything else is same-origin or server to server, so the open policy is
  // scoped to exactly the routes that need it.
  app.use(
    "/public/*",
    cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: 3600 }),
  );

  app.get("/health", async (c) => {
    // A health check that does not touch the database is a health check that
    // stays green while the thing is unusable.
    try {
      const [row] = await sql<{ ok: number }[]>`select 1 as ok`;
      return c.json({ ok: row?.ok === 1, service: "keiki-api", database: "up" });
    } catch (err) {
      return c.json(
        {
          ok: false,
          service: "keiki-api",
          database: "down",
          error: err instanceof Error ? err.message : String(err),
        },
        503,
      );
    }
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    console.error("[api] unhandled", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
