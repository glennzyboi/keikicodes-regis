"use client";

import { useActionState } from "react";
import { runImport } from "../actions";
import { Stat } from "../../ui";

/**
 * Dry run first, always.
 *
 * The import is idempotent and upserts on natural keys, so running it twice
 * changes nothing the second time. That is still not a reason to make somebody
 * find out by doing it. The dry run does the entire thing inside a transaction
 * that is then rolled back, so what it reports is what happened, not what a
 * simulation predicted.
 */
export function ImportPanel({
  counts,
}: {
  counts: { schools: number; programs: number; offerings: number; sessions: number };
}) {
  const [state, action, pending] = useActionState(runImport, null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon="users" label="Campuses" value={String(counts.schools)} />
        <Stat icon="book" label="Programs" value={String(counts.programs)} />
        <Stat icon="grid" label="Classes" value={String(counts.offerings)} />
        <Stat icon="calendar" label="Sessions" value={String(counts.sessions)} />
      </div>

      <div className="ops-panel p-4">
        <h2 className="ops-panel-head">Run it</h2>
        <p className="mt-2 max-w-2xl text-[var(--ops-muted)]">
          Campuses, programs, terms and classes are matched on their natural keys, so this
          updates what is already here rather than making copies. Holidays are replaced from
          their records, and each schedule is regenerated and then checked against the
          session count they publish. Anything that disagrees is reported rather than
          quietly accepted.
        </p>
        <p className="mt-2 max-w-2xl text-[var(--ops-muted)]">
          A class already here keeps its capacity, because their endpoint does not publish
          one and overwriting a number somebody set by hand would be worse than leaving it.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="source" value="live" />
            <input type="hidden" name="dryRun" value="on" />
            <button className="ops-btn" disabled={pending}>
              {pending ? "Reading..." : "Dry run"}
            </button>
          </form>
          <form action={action}>
            <input type="hidden" name="source" value="live" />
            <input type="hidden" name="dryRun" value="" />
            <button className="ops-btn ops-btn-primary" disabled={pending}>
              {pending ? "Importing..." : "Import for real"}
            </button>
          </form>
        </div>

        {state && (
          <p className={`mt-4 ${state.ok ? "ops-ok" : "ops-warn"}`} role="status">
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>

      <div className="ops-panel p-4">
        <h2 className="ops-panel-head">Pointing your website here</h2>
        <p className="mt-2 max-w-2xl text-[var(--ops-muted)]">
          The find-a-program page has a code block with one line naming where the catalogue
          comes from. These endpoints answer in the same shape, so switching is that line,
          and switching back is the same line again.
        </p>
        <pre className="ops-mono mt-3 overflow-x-auto rounded-md bg-[var(--ops-line)] p-3">
{`var API = 'https://n8n.keikicoders.com/webhook/';   // today
var API = 'https://api.keikicoders.com/public/';    // after`}
        </pre>
        <p className="mt-2 text-[var(--ops-muted)]">
          Names differ slightly: theirs are get-programs and get-schools, ours are programs
          and schools.
        </p>
      </div>
    </div>
  );
}
