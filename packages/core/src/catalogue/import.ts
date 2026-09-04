import type { TransactionSql } from "postgres";
import { sql } from "../db";
import { copyImage, isOurs } from "./images";
import {
  parseSnapshot,
  countSessions,
  slugify,
  type ParsedOffering,
  type ParsedSchool,
  type Snapshot,
} from "./parse";

/**
 * Bringing their catalogue across.
 *
 * This is the migration path, in one function. It reads their live n8n
 * endpoints, or a committed snapshot of them, and upserts the result into our
 * tables on natural keys, so it can be run as many times as anyone likes and
 * the second run changes nothing.
 *
 * Three deliberate decisions, because they are the ones that get asked about:
 *
 * 1. **It only ever reads from them.** Nothing here writes to their Airtable.
 *    Dual writing between two systems that both think they are the source of
 *    truth is where migrations of this shape die, and the answer is to pick a
 *    direction and a cutover date rather than to be clever.
 *
 * 2. **It reconciles rather than trusts.** Every record carries their own
 *    session count. We generate the schedule from first date, last date,
 *    weekday and holidays, and compare. A disagreement is reported per
 *    offering; it never fails quietly.
 *
 * 3. **Capacity is the one thing it cannot know.** Their public endpoint does
 *    not expose it, so a new offering lands with a stated default and is listed
 *    in the report as needing a human. Guessing a number and saying nothing
 *    would be the worst of the three options.
 */

export const DEFAULT_CAPACITY = 16;

export type ImportSource =
  | { kind: "live"; programsUrl: string; schoolsUrl: string }
  | { kind: "snapshot"; snapshot: Snapshot };

export type OfferingOutcome = {
  id: string;
  title: string;
  school: string;
  term: string;
  action: "created" | "updated" | "unchanged";
  /** What the schedule produces: weekday occurrences in range, minus holidays. */
  sessionsScheduled: number;
  /** How many of those are currently running, after any staff cancellations. */
  sessionsRunning: number;
  /** Sessions a person cancelled. A legitimate difference, not a mismatch. */
  staffCancelled: number;
  sessionsStated: number | null;
  reconciles: boolean;
  problems: string[];
};

export type ImportReport = {
  source: "live" | "snapshot";
  capturedAt: string | null;
  dryRun: boolean;
  schools: { created: number; updated: number; unchanged: number };
  programs: { created: number; updated: number; unchanged: number };
  terms: { created: number; updated: number; unchanged: number };
  offerings: OfferingOutcome[];
  /** Every school id the import touched, so a caller can prune the rest. */
  schoolIds: string[];
  needCapacity: string[];
  unusable: { title: string; problems: string[] }[];
  mismatches: OfferingOutcome[];
  /** Pictures copied into our own storage, and the ones that would not come. */
  images: { copied: number; failed: { what: string; problem: string }[] };
};

export const LIVE_SOURCE: Extract<ImportSource, { kind: "live" }> = {
  kind: "live",
  programsUrl: "https://n8n.keikicoders.com/webhook/get-programs",
  schoolsUrl: "https://n8n.keikicoders.com/webhook/get-schools",
};

/** Fetch their two endpoints into the snapshot shape. */
export async function fetchLiveSnapshot(
  source: Extract<ImportSource, { kind: "live" }>,
  timeoutMs = 15_000,
): Promise<Snapshot> {
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`${url} did not return a list`);
    return body;
  };
  const [programs, schools] = await Promise.all([get(source.programsUrl), get(source.schoolsUrl)]);
  return { capturedAt: new Date().toISOString(), schools, programs };
}

type Counts = { created: number; updated: number; unchanged: number };
const zero = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });

/**
 * Run the import.
 *
 * The whole thing is one transaction. A catalogue half imported is worse than
 * one not imported at all, because the difference is invisible until a parent
 * hits a class whose sessions were never generated.
 */
export async function importCatalogue(opts: {
  source: ImportSource;
  dryRun?: boolean;
  defaultCapacity?: number;
}): Promise<ImportReport> {
  const dryRun = opts.dryRun ?? false;
  const capacity = opts.defaultCapacity ?? DEFAULT_CAPACITY;

  const snapshot =
    opts.source.kind === "live" ? await fetchLiveSnapshot(opts.source) : opts.source.snapshot;

  const { schools, offerings, unusable } = parseSnapshot(snapshot);

  const report: ImportReport = {
    source: opts.source.kind,
    capturedAt: snapshot.capturedAt ?? null,
    dryRun,
    schools: zero(),
    programs: zero(),
    terms: zero(),
    offerings: [],
    schoolIds: [],
    needCapacity: [],
    unusable,
    mismatches: [],
    images: { copied: 0, failed: [] },
  };

  await sql.begin(async (tx) => {
    const schoolIds = await upsertSchools(tx, schools, offerings, report);
    report.schoolIds = [...schoolIds.values()];
    const programIds = await upsertPrograms(tx, offerings, report);
    const termIds = await upsertTerms(tx, offerings, report);

    for (const o of offerings) {
      const schoolId = schoolIds.get(o.schoolName);
      const programId = programIds.get(o.programSlug);
      const termId = termIds.get(o.termName);
      if (!schoolId || !programId || !termId) {
        report.unusable.push({
          title: o.title,
          problems: [...o.problems, "could not resolve its school, program or term"],
        });
        continue;
      }

      const outcome = await upsertOffering(tx, o, { schoolId, programId, termId, capacity }, report);
      report.offerings.push(outcome);
      if (!outcome.reconciles) report.mismatches.push(outcome);
    }

    if (dryRun) {
      // Everything above ran, so the report is real rather than predicted. It
      // just does not get to keep any of it.
      throw new DryRun();
    }
  }).catch((err) => {
    if (!(err instanceof DryRun)) throw err;
  });

  return report;
}

class DryRun extends Error {
  constructor() {
    super("dry run");
  }
}

// The transaction handle. Spelled out rather than inferred off sql.begin,
// whose parameter types collapse to never through the overloads.
type Tx = TransactionSql<Record<string, unknown>>;

async function upsertSchools(
  tx: Tx,
  schools: ParsedSchool[],
  offerings: ParsedOffering[],
  report: ImportReport,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  // A campus that appears on an offering but not in their schools list still
  // has to exist, or the offering is dropped for a reason nobody would guess.
  const named = new Set(schools.map((s) => s.name));
  const extras = [...new Set(offerings.map((o) => o.schoolName))]
    .filter((n) => n && !named.has(n))
    .map<ParsedSchool>((name) => ({
      name,
      slug: slugify(name),
      kind: null,
      area: null,
      logoUrl: null,
    }));

  for (const s of [...schools, ...extras]) {
    const [before] = await tx<{ id: string; name: string; kind: string | null; area: string | null; logo_url: string | null }[]>`
      select id, name, kind, area, logo_url from schools where slug = ${s.slug}`;

    // Their logo URLs are signed Airtable attachments and expire, so we keep
    // our own copy. Skipped when what we already hold is ours.
    if (s.logoUrl && !isOurs(before?.logo_url)) {
      const copy = await copyImage(s.logoUrl, "school", s.slug);
      if (copy.copied) report.images.copied += 1;
      else if (copy.problem) report.images.failed.push({ what: s.name, problem: copy.problem });
      s.logoUrl = copy.url;
    } else if (isOurs(before?.logo_url)) {
      s.logoUrl = before!.logo_url;
    }

    const [row] = await tx<{ id: string }[]>`
      insert into schools (name, slug, kind, area, logo_url)
      values (${s.name}, ${s.slug}, ${s.kind}, ${s.area}, ${s.logoUrl})
      on conflict (slug) do update
        set name     = excluded.name,
            kind     = coalesce(excluded.kind, schools.kind),
            area     = coalesce(excluded.area, schools.area),
            logo_url = coalesce(excluded.logo_url, schools.logo_url)
      returning id`;

    ids.set(s.name, row.id);
    if (!before) report.schools.created += 1;
    else if (
      before.name !== s.name ||
      (s.kind && before.kind !== s.kind) ||
      (s.area && before.area !== s.area) ||
      (s.logoUrl && before.logo_url !== s.logoUrl)
    )
      report.schools.updated += 1;
    else report.schools.unchanged += 1;
  }

  return ids;
}

async function upsertPrograms(
  tx: Tx,
  offerings: ParsedOffering[],
  report: ImportReport,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  // One offering per curriculum decides its description and picture. They are
  // identical across campuses in their data; taking the longest description
  // means a campus that left the field blank cannot blank the program.
  const bySlug = new Map<string, ParsedOffering>();
  for (const o of offerings) {
    const seen = bySlug.get(o.programSlug);
    if (!seen || (o.description?.length ?? 0) > (seen.description?.length ?? 0)) {
      bySlug.set(o.programSlug, o);
    }
  }

  for (const [slug, o] of bySlug) {
    const [before] = await tx<{ id: string; description: string | null; image_url: string | null }[]>`
      select id, description, image_url from programs where slug = ${slug}`;

    let imageUrl = o.imageUrl;
    if (imageUrl && !isOurs(before?.image_url)) {
      const copy = await copyImage(imageUrl, "program", slug);
      if (copy.copied) report.images.copied += 1;
      else if (copy.problem) {
        report.images.failed.push({ what: o.programName, problem: copy.problem });
      }
      imageUrl = copy.url;
    } else if (isOurs(before?.image_url)) {
      imageUrl = before!.image_url;
    }

    const [row] = await tx<{ id: string }[]>`
      insert into programs (slug, name, track, subject, description, image_url)
      values (${slug}, ${o.programName}, ${o.track}, ${o.subject}, ${o.description}, ${imageUrl})
      on conflict (slug) do update
        set name        = excluded.name,
            track       = coalesce(excluded.track, programs.track),
            subject     = coalesce(excluded.subject, programs.subject),
            description = coalesce(excluded.description, programs.description),
            image_url   = coalesce(excluded.image_url, programs.image_url)
      returning id`;

    ids.set(slug, row.id);
    if (!before) report.programs.created += 1;
    else if (before.description !== o.description) report.programs.updated += 1;
    else report.programs.unchanged += 1;
  }

  return ids;
}

async function upsertTerms(
  tx: Tx,
  offerings: ParsedOffering[],
  report: ImportReport,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  // A term's dates are the envelope of everything running in it. Their records
  // do not carry term dates at all; this is the only place they exist.
  const spans = new Map<string, { first: string; last: string }>();
  for (const o of offerings) {
    const s = spans.get(o.termName);
    if (!s) spans.set(o.termName, { first: o.firstSessionDate, last: o.lastSessionDate });
    else {
      if (o.firstSessionDate < s.first) s.first = o.firstSessionDate;
      if (o.lastSessionDate > s.last) s.last = o.lastSessionDate;
    }
  }

  for (const [name, span] of spans) {
    const [before] = await tx<{ id: string }[]>`
      select id from terms where lower(name) = lower(${name})`;

    const [row] = await tx<{ id: string }[]>`
      insert into terms (name, starts_on, ends_on)
      values (${name}, ${span.first}::date, ${span.last}::date)
      on conflict (lower(name)) do update
        set starts_on = least(terms.starts_on, excluded.starts_on),
            ends_on   = greatest(terms.ends_on, excluded.ends_on)
      returning id`;

    ids.set(name, row.id);
    if (!before) report.terms.created += 1;
    else report.terms.updated += 1;
  }

  // Whichever term is running now, or the newest if none is. Their form has
  // this as a hardcoded record id that somebody has to remember to change.
  await tx`
    update terms set is_current = (id = (
      select id from terms
       order by (starts_on <= current_date and ends_on >= current_date) desc, starts_on desc
       limit 1))`;

  return ids;
}

async function upsertOffering(
  tx: Tx,
  o: ParsedOffering,
  ctx: { schoolId: string; programId: string; termId: string; capacity: number },
  report: ImportReport,
): Promise<OfferingOutcome> {
  const [before] = await tx<
    { id: string; capacity: number; price_cents: number | null; first_session_date: string }[]
  >`select id, capacity, price_cents, first_session_date
      from class_offerings
     where school_id = ${ctx.schoolId} and term_id = ${ctx.termId}
       and lower(title) = lower(${o.title})`;

  const [row] = await tx<{ id: string }[]>`
    insert into class_offerings (
      school_id, program_id, term_id, title, summary,
      weekday, start_time, end_time, first_session_date, last_session_date,
      grade_min, grade_max, capacity, price_cents,
      registration_mode, external_registration_url,
      location, special_notes, registration_opens_at, status
    ) values (
      ${ctx.schoolId}, ${ctx.programId}, ${ctx.termId}, ${o.title}, ${o.description},
      ${o.weekday}, ${o.startTime}::time, ${o.endTime}::time,
      ${o.firstSessionDate}::date, ${o.lastSessionDate}::date,
      ${o.gradeMin}, ${o.gradeMax}, ${before?.capacity ?? ctx.capacity}, ${o.priceCents},
      ${o.registrationMode}, ${o.externalRegistrationUrl},
      ${o.location}, ${o.specialNotes}, now() - interval '1 day', 'published'
    )
    on conflict (school_id, term_id, lower(title)) do update
      set program_id               = excluded.program_id,
          summary                  = excluded.summary,
          weekday                  = excluded.weekday,
          start_time               = excluded.start_time,
          end_time                 = excluded.end_time,
          first_session_date       = excluded.first_session_date,
          last_session_date        = excluded.last_session_date,
          grade_min                = excluded.grade_min,
          grade_max                = excluded.grade_max,
          price_cents              = excluded.price_cents,
          registration_mode        = excluded.registration_mode,
          external_registration_url = excluded.external_registration_url,
          location                 = excluded.location,
          special_notes            = excluded.special_notes
    returning id`;

  // Blackouts are replaced wholesale: their list is the truth, and a holiday
  // they withdrew has to actually go, or the class stays cancelled forever.
  // Anything a human cancelled by hand is a session, not a blackout, so this
  // cannot touch it.
  await tx`delete from offering_blackouts where class_offering_id = ${row.id}`;
  for (const d of o.blackoutDates) {
    await tx`insert into offering_blackouts (class_offering_id, blackout_date, reason)
             values (${row.id}, ${d}::date, 'No class')
             on conflict do nothing`;
  }

  const [gen] = await tx<{ scheduled: number; cancelled: number; removed: number }[]>`
    select * from generate_sessions(${row.id})`;

  // What the schedule produces, worked out independently of the database so
  // the two can be compared rather than one trusted.
  const expected = countSessions(
    o.firstSessionDate,
    o.lastSessionDate,
    o.weekday,
    o.blackoutDates,
  );

  /**
   * Sessions a person cancelled, which are not a holiday and not a mistake.
   *
   * This distinction cost a real bug. The check used to compare the number of
   * sessions currently running against the number they publish, so the moment
   * the office cancelled one afternoon for a sick teacher, the next import
   * reported that three schedules "do not reconcile" and asked somebody to
   * investigate a decision they had made themselves the week before. An alert
   * that fires on correct behaviour is an alert people learn to ignore.
   *
   * So the comparison is against what the schedule produces, and staff
   * cancellations are counted and reported separately.
   */
  const [{ n: staffCancelled }] = await tx<{ n: number }[]>`
    select count(*)::int as n from sessions
     where class_offering_id = ${row.id}
       and status = 'cancelled' and not from_blackout`;

  if (!before) report.needCapacity.push(`${o.title} at ${o.schoolName}`);

  return {
    id: row.id,
    title: o.title,
    school: o.schoolName,
    term: o.termName,
    action: before ? "updated" : "created",
    sessionsScheduled: gen.scheduled + staffCancelled,
    sessionsRunning: gen.scheduled,
    staffCancelled,
    sessionsStated: o.statedSessions,
    // Two checks in one: the schedule the database holds agrees with our own
    // arithmetic, and both agree with what they publish. Either disagreement is
    // worth a human; a cancellation somebody made on purpose is not.
    reconciles:
      gen.scheduled + staffCancelled === expected &&
      (o.statedSessions == null || o.statedSessions === expected),
    problems: o.problems,
  };
}
