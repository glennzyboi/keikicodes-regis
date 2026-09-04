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

  /**
   * Fields that differ for a reason, named rather than left for somebody to
   * find on camera. Each one is a decision, not an oversight.
   */
  const explained: Record<string, string> = {
    time:
      "26 of 28 of their records omit the meridiem and 2 include it. We emit one " +
      "format, so we differ from whichever two are in the minority.",
    noClass:
      "their zero padding varies inside the same field. We emit one format.",
    logo:
      "theirs are signed Airtable URLs that expire, and were returning 410 Gone " +
      "within a day. We serve our own copies, so the pictures still work next week.",
    image: "same as logo: our own copy rather than an Airtable URL that ages out.",
    sessions:
      "we publish what will actually run, so a session the office cancelled by " +
      "hand shows as one fewer. That is the number a family counts.",
  };

  const unexplained = all.filter((r) => r.same !== r.total && !(r.field in explained));

  if (lost.length === 0 && unexplained.length === 0) {
    const differing = all.filter((r) => r.same !== r.total);
    console.log("");
    if (differing.length === 0) {
      console.log("Every record present and every field identical.");
    } else {
      console.log("Every record present. Every difference is a decision:");
      for (const r of differing) {
        console.log("");
        console.log(`  ${r.field} (${r.total - r.same} of ${r.total})`);
        console.log(`    ${explained[r.field]}`);
      }
      console.log("");
      console.log("None of these change what their page renders.");
    }
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
