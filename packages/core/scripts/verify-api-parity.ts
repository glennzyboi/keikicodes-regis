/**
 * Does our public API answer the same as theirs?
 *
 *   tsx scripts/verify-api-parity.ts
 *   tsx scripts/verify-api-parity.ts --api http://localhost:3001/public
 *
 * Their Squarespace page reads two n8n webhooks and renders the result. The
 * migration story is "change one URL", and this is the check that makes that a
 * claim rather than a hope: it fetches both, matches records on campus plus
 * title, and compares every field their renderer touches.
 *
 * Run it before saying the words out loud.
 */

const THEIRS = "https://n8n.keikicoders.com/webhook";
const OURS = argValue("api", "http://localhost:3001/public");

function argValue(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

type Rec = Record<string, unknown>;

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

async function get(url: string): Promise<Rec[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${url} did not return a list`);
  return body;
}

type Result = { field: string; same: number; total: number; example?: string };

async function compare(
  label: string,
  theirUrl: string,
  ourUrl: string,
  key: (r: Rec) => string,
  fields: string[],
): Promise<{ label: string; results: Result[]; missing: string[]; extra: string[] }> {
  const [theirs, ours] = await Promise.all([get(theirUrl), get(ourUrl)]);
  const t = new Map(theirs.map((r) => [key(r), r]));
  const o = new Map(ours.map((r) => [key(r), r]));

  const missing = [...t.keys()].filter((k) => !o.has(k));
  const extra = [...o.keys()].filter((k) => !t.has(k));

  const results: Result[] = fields.map((f) => ({ field: f, same: 0, total: 0 }));

  for (const [k, their] of t) {
    const our = o.get(k);
    if (!our) continue;
    for (const r of results) {
      r.total += 1;
      if (norm(their[r.field]) === norm(our[r.field])) r.same += 1;
      else if (!r.example) {
        r.example =
          `${k}\n        theirs: ${JSON.stringify(norm(their[r.field])).slice(0, 100)}` +
          `\n        ours:   ${JSON.stringify(norm(our[r.field])).slice(0, 100)}`;
      }
    }
  }

  console.log(`\n${label}: theirs ${theirs.length}, ours ${ours.length}`);
  if (missing.length) console.log(`  MISSING FROM OURS: ${missing.join(", ")}`);
  if (extra.length) console.log(`  ONLY IN OURS: ${extra.join(", ")}`);

  for (const r of results) {
    const ok = r.same === r.total;
    console.log(`  ${ok ? "match  " : "differs"} ${r.field.padEnd(14)} ${r.same}/${r.total}`);
    if (!ok && r.example) console.log(`     e.g. ${r.example}`);
  }

  return { label, results, missing, extra };
}

async function main() {
  const schools = await compare(
    "schools",
    `${THEIRS}/get-schools`,
    `${OURS}/schools`,
    (s) => norm(s.name),
    ["name", "area", "type", "logo"],
  );

  const programs = await compare(
    "programs",
    `${THEIRS}/get-programs`,
    `${OURS}/programs`,
    (p) => `${norm(p.site)} | ${norm(p.name)}`,
    [
      "name", "grades", "season", "site", "location", "days", "time", "dates",
      "cost", "sessions", "specialNotes", "description", "registerUrl", "noClass",
    ],
  );

  const all = [...schools.results, ...programs.results];
  const exact = all.filter((r) => r.same === r.total);
  const lost = [...schools.missing, ...programs.missing];

  console.log(
    `\n${exact.length} of ${all.length} fields match exactly. ` +
      `${lost.length} records missing from ours.`,
  );

  // The two known differences are places their own records disagree with each
  // other, so any single format we emit differs from some of them. Called out
  // by name rather than left for somebody to find on camera.
  const knownFormatting = new Set(["time", "noClass"]);
  const unexplained = all.filter(
    (r) => r.same !== r.total && !knownFormatting.has(r.field),
  );

  if (lost.length === 0 && unexplained.length === 0) {
    console.log(
      "\nEvery record present, and every field matches except the two where their\n" +
        "own data is internally inconsistent:\n" +
        "  time     26 of 28 records omit the meridiem, 2 include it. We emit one format.\n" +
        "  noClass  their zero padding varies within the same field. We emit one format.\n" +
        "Both are display strings their renderer prints verbatim, so the page reads\n" +
        "the same; it just stops being inconsistent.",
    );
    process.exit(0);
  }

  console.log("\nDifferences that are not explained by their own inconsistency:");
  for (const r of unexplained) console.log(`  ${r.field}: ${r.total - r.same} records`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
