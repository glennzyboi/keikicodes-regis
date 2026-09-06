import { sql } from "@keiki/core/db";

/**
 * Reading the catalogue.
 *
 * Everything comes from the offering_details view, so the join and the
 * arithmetic exist once rather than being rebuilt slightly differently on every
 * page. In particular sessionCount is the number of sessions that will actually
 * run, holidays already taken out, which is not the same as the length of the
 * term and is what a parent is really asking.
 */

export type Offering = {
  id: string;
  title: string;
  summary: string | null;
  status: "draft" | "published" | "closed";
  weekday: number;
  startTime: string;
  endTime: string;
  firstSession: string;
  lastSession: string | null;
  sessionCount: number;
  cancelledCount: number;
  capacity: number;
  seatsTaken: number;
  seatsLeft: number;
  /**
   * The two halves of `seatsTaken`, and when the earliest hold lapses.
   *
   * `seatsTaken` alone cannot tell a family whether a class is genuinely gone or
   * simply has two checkouts open, and those are different answers: one is
   * "look elsewhere", the other is "check back in six minutes". Treating them as
   * the same number turns an abandoned basket into a lost customer.
   */
  seatsConfirmed: number;
  seatsHeld: number;
  holdExpiresNext: string | null;
  priceCents: number | null;
  registrationMode: "keiki_coders" | "external";
  externalUrl: string | null;
  location: string | null;
  specialNotes: string | null;
  gradeMin: number | null;
  gradeMax: number | null;
  gradeLabel: string | null;

  schoolId: string;
  school: string;
  schoolSlug: string;
  timezone: string;

  programId: string;
  programName: string;
  programSlug: string;
  track: string | null;
  subject: string | null;
  description: string | null;

  termId: string;
  term: string;
};

type Row = Record<string, unknown>;

/**
 * A date column as "YYYY-MM-DD".
 *
 * postgres.js hands back a real Date for a `date` column, built at UTC
 * midnight. String(date).slice(0, 10) therefore produces "Tue Aug 25", which
 * parses to nothing and takes the page down with a RangeError rather than
 * showing a wrong date. Everything that reads a date goes through here.
 */
export function isoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

const toOffering = (r: Row): Offering => ({
  id: r.id as string,
  title: r.title as string,
  summary: (r.summary as string) ?? null,
  status: r.status as "draft" | "published" | "closed",
  weekday: Number(r.weekday),
  startTime: r.start_time as string,
  endTime: r.end_time as string,
  firstSession: isoDate(r.first_session_date) ?? "",
  lastSession: isoDate(r.last_scheduled_date),
  sessionCount: Number(r.session_count ?? 0),
  cancelledCount: Number(r.cancelled_count ?? 0),
  capacity: Number(r.capacity),
  seatsTaken: Number(r.seats_taken),
  seatsLeft: Number(r.seats_left),
  seatsConfirmed: Number(r.seats_confirmed ?? 0),
  seatsHeld: Number(r.seats_held ?? 0),
  holdExpiresNext:
    r.hold_expires_next instanceof Date
      ? r.hold_expires_next.toISOString()
      : ((r.hold_expires_next as string) ?? null),
  priceCents: r.price_cents === null ? null : Number(r.price_cents),
  registrationMode: r.registration_mode as "keiki_coders" | "external",
  externalUrl: (r.external_registration_url as string) ?? null,
  location: (r.location as string) ?? null,
  specialNotes: (r.special_notes as string) ?? null,
  gradeMin: r.grade_min === null ? null : Number(r.grade_min),
  gradeMax: r.grade_max === null ? null : Number(r.grade_max),
  gradeLabel: (r.grade_label as string) ?? null,

  schoolId: r.school_id as string,
  school: r.school_name as string,
  schoolSlug: r.school_slug as string,
  timezone: r.school_timezone as string,

  programId: r.program_id as string,
  programName: r.program_name as string,
  programSlug: r.program_slug as string,
  track: (r.program_track as string) ?? null,
  subject: (r.program_subject as string) ?? null,
  description: (r.program_description as string) ?? null,

  termId: r.term_id as string,
  term: r.term_name as string,
});

export type Campus = {
  id: string;
  name: string;
  slug: string;
  kind: string | null;
  area: string | null;
  logoUrl: string | null;
  offerings: number;
  seatsLeft: number;
  /** Set when every class at this campus is enrolled through the school. */
  allExternal: boolean;
};

/**
 * Every campus with something running, and how much.
 *
 * A campus with nothing published this term is left out rather than shown
 * empty: their own page lists four schools with no programs, and a parent who
 * clicks one has been sent nowhere for no reason.
 */
export async function campuses(): Promise<Campus[]> {
  const rows = await sql<Row[]>`
    select s.id, s.name, s.slug, s.kind, s.area, s.logo_url,
           count(*)::int                                          as offerings,
           coalesce(sum(greatest(c.capacity - c.seats_taken, 0)), 0)::int as seats_left,
           bool_and(c.registration_mode = 'external')             as all_external
      from class_offerings c
      join schools s on s.id = c.school_id
     where c.status = 'published'
     group by s.id, s.name, s.slug, s.kind, s.area, s.logo_url
     order by s.name`;

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    kind: (r.kind as string) ?? null,
    area: (r.area as string) ?? null,
    logoUrl: (r.logo_url as string) ?? null,
    offerings: Number(r.offerings),
    seatsLeft: Number(r.seats_left),
    allExternal: Boolean(r.all_external),
  }));
}

/** Everything published, newest term first, campus then start time. */
export async function publishedOfferings(): Promise<Offering[]> {
  const rows = await sql<Row[]>`
    select * from offering_details
     where status = 'published'
     order by school_name, weekday, start_time`;
  return rows.map(toOffering);
}

export async function offeringsAtSchool(slug: string): Promise<Offering[]> {
  const rows = await sql<Row[]>`
    select * from offering_details
     where status = 'published' and school_slug = ${slug}
     order by weekday, start_time`;
  return rows.map(toOffering);
}

export async function offeringById(id: string): Promise<Offering | null> {
  const [row] = await sql<Row[]>`select * from offering_details where id = ${id}`;
  return row ? toOffering(row) : null;
}

export async function schoolBySlug(
  slug: string,
): Promise<{ id: string; name: string; slug: string; kind: string | null; area: string | null; logoUrl: string | null; externalUrl: string | null } | null> {
  const [row] = await sql<Row[]>`
    select id, name, slug, kind, area, logo_url, external_registration_url
      from schools where slug = ${slug}`;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    kind: (row.kind as string) ?? null,
    area: (row.area as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    externalUrl: (row.external_registration_url as string) ?? null,
  };
}

/** The dates a class actually runs, and the ones it does not. */
export async function sessionsFor(
  offeringId: string,
): Promise<{ date: string; status: string; note: string | null; fromBlackout: boolean }[]> {
  const rows = await sql<Row[]>`
    select session_date, status, note, from_blackout
      from sessions where class_offering_id = ${offeringId}
     order by session_date`;
  return rows.map((r) => ({
    date: isoDate(r.session_date) ?? "",
    status: r.status as string,
    note: (r.note as string) ?? null,
    fromBlackout: Boolean(r.from_blackout),
  }));
}

// Grade helpers live in ./grades, which imports nothing, so a client component
// can use them without dragging the database driver into the browser bundle.
export { GRADE_LABELS, gradeName, gradeRangeLabel, gradeFits } from "./grades";
