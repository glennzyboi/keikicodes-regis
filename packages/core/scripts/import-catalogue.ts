/**
 * Import their catalogue.
 *
 *   tsx scripts/import-catalogue.ts              live, falling back to the snapshot
 *   tsx scripts/import-catalogue.ts --snapshot   the committed snapshot only
 *   tsx scripts/import-catalogue.ts --dry        run it all, keep none of it
 *
 * Live by default, because the point of the exercise is that it reads their
 * real system. Snapshot as a fallback, because a demo that depends on somebody
 * else's server being up at the moment you press record is not a demo.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "../src/db";
import { importCatalogue, LIVE_SOURCE, type ImportReport, type ImportSource } from "../src/catalogue/import";
import type { Snapshot } from "../src/catalogue/parse";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = path.resolve(
  here,
  "../../../fixtures/keikicoders-catalogue-2026-09-04.json",
);

export function readSnapshot(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
}

/**
 * Live if it answers, the snapshot if it does not, and say which out loud.
 * Silently falling back would mean demonstrating the snapshot while claiming
 * to demonstrate the integration.
 */
export async function chooseSource(preferLive: boolean): Promise<ImportSource> {
  if (!preferLive) return { kind: "snapshot", snapshot: readSnapshot() };
  try {
    const res = await fetch(LIVE_SOURCE.programsUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    return LIVE_SOURCE;
  } catch (err) {
    console.log(
      `  their endpoint did not answer (${err instanceof Error ? err.message : err}), using the committed snapshot`,
    );
    return { kind: "snapshot", snapshot: readSnapshot() };
  }
}

export function printReport(r: ImportReport) {
  const line = (label: string, c: { created: number; updated: number; unchanged: number }) =>
    console.log(
      `  ${label.padEnd(10)} ${String(c.created).padStart(3)} new  ${String(c.updated).padStart(3)} changed  ${String(c.unchanged).padStart(3)} same`,
    );

  console.log("");
  console.log(`Source: ${r.source}${r.capturedAt ? ` (captured ${r.capturedAt})` : ""}`);
  if (r.dryRun) console.log("DRY RUN. Nothing was kept.");
  console.log("");
  line("schools", r.schools);
  line("programs", r.programs);
  line("terms", r.terms);
  console.log(
    `  offerings  ${String(r.offerings.filter((o) => o.action === "created").length).padStart(3)} new  ` +
      `${String(r.offerings.filter((o) => o.action === "updated").length).padStart(3)} changed`,
  );

  const total = r.offerings.reduce((n, o) => n + o.sessionsGenerated, 0);
  const agree = r.offerings.filter((o) => o.reconciles).length;
  console.log("");
  console.log(`  ${total} sessions generated across ${r.offerings.length} offerings`);
  console.log(`  ${agree} of ${r.offerings.length} reconcile against their own published counts`);

  if (r.mismatches.length) {
    console.log("");
    console.log("  Session counts that disagree with theirs:");
    for (const m of r.mismatches) {
      console.log(`    ${m.title} at ${m.school}: they say ${m.sessionsStated}, we make ${m.sessionsGenerated}`);
    }
  }

  const problems = r.offerings.filter((o) => o.problems.length);
  if (problems.length) {
    console.log("");
    console.log("  Records with something wrong in them:");
    for (const p of problems) console.log(`    ${p.title} at ${p.school}: ${p.problems.join("; ")}`);
  }

  if (r.unusable.length) {
    console.log("");
    console.log("  Records that could not be imported at all:");
    for (const u of r.unusable) console.log(`    ${u.title}: ${u.problems.join("; ")}`);
  }

  if (r.needCapacity.length) {
    console.log("");
    console.log(`  ${r.needCapacity.length} offerings need a capacity set by hand.`);
    console.log("  Their public endpoint does not publish it, so this is the one number");
    console.log("  the import cannot know. Everything landed on the default.");
  }
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry") || args.includes("--dry-run");
  const preferLive = !args.includes("--snapshot");

  const source = await chooseSource(preferLive);
  const report = await importCatalogue({ source, dryRun });
  printReport(report);

  await sql.end();
  // A mismatch is not a crash, but it is not a success either. Exit non-zero so
  // this can sit in a pipeline without anyone having to read the output.
  process.exit(report.mismatches.length || report.unusable.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
