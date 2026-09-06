import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runNotify } from "@keiki/core/jobs/notify";

/**
 * Drain the outbox, once, on request.
 *
 * The worker itself is unchanged — this is the same `runNotify` the CLI calls
 * and the same one a Render cron would call. What is new is a way to *trigger*
 * it on a deployment where nothing long-running exists to hold a timer: Vercel
 * functions are request-scoped, and a free Render service is asleep for most of
 * the day, which is exactly when a confirmation is sitting in the queue.
 *
 * So the schedule lives where the sweeper's schedule already lives: pg_cron in
 * the database, calling this URL once a minute through pg_net. The database is
 * the one component that cannot be asleep while there is anything to do. See
 * `packages/core/scripts/schedule-outbox-drain.ts`, which sets that up, and
 * `20260906090000_sweep_on_a_schedule.sql` for the same argument made about
 * seat holds.
 *
 * ## Why this is safe to expose
 *
 * It is POST-only and requires a shared secret in a header, compared with
 * `timingSafeEqual` so the comparison does not leak the secret a byte at a time.
 * Beyond that, the endpoint has no parameters at all: there is nothing to pass
 * it, so there is nothing to inject. The worst an attacker with the secret can
 * do is cause queued mail to be sent slightly sooner than it would have been.
 *
 * It is also idempotent under concurrency for free, because claiming uses
 * `FOR UPDATE SKIP LOCKED`: two overlapping calls take different rows rather
 * than sending the same message twice. That property is the worker's, not this
 * route's, which is why this route stays four lines long.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const expected = process.env.JOB_SECRET;
  if (!expected) return false;

  const given = request.headers.get("x-job-secret") ?? "";

  // Constant time, and length-safe: timingSafeEqual throws on a length
  // mismatch, which would itself be an oracle, so both sides are hashed to a
  // fixed width first.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "not_authorised" }, { status: 401 });
  }

  const lines: string[] = [];
  try {
    const handled = await runNotify({ log: (l) => lines.push(l) });
    return NextResponse.json({ ok: true, handled, log: lines });
  } catch (err) {
    // Logged rather than swallowed: a scheduler with no visibility into its own
    // failures is a scheduler nobody trusts.
    console.error("[job:notify] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log: lines },
      { status: 500 },
    );
  }
}
