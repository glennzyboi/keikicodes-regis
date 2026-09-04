import { sql } from "@keiki/core/db";

/** Reads for the catalogue console. Staff only; the pages check before calling. */

export type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  kind: string | null;
  area: string | null;
  timezone: string;
  logoUrl: string | null;
  externalUrl: string | null;
  active: boolean;
  offerings: number;
  published: number;
  enrolled: number;
};

export async function schools(): Promise<SchoolRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select s.id, s.name, s.slug, s.kind, s.area, s.timezone, s.logo_url,
           s.external_registration_url, s.active,
           count(c.id)::int                                           as offerings,
           count(c.id) filter (where c.status = 'published')::int      as published,
           coalesce(sum(c.seats_taken), 0)::int                        as enrolled
      from schools s
      left join class_offerings c on c.school_id = s.id
     group by s.id
     order by s.name`;

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    kind: (r.kind as string) ?? null,
    area: (r.area as string) ?? null,
    timezone: r.timezone as string,
    logoUrl: (r.logo_url as string) ?? null,
    externalUrl: (r.external_registration_url as string) ?? null,
    active: Boolean(r.active),
    offerings: Number(r.offerings),
    published: Number(r.published),
    enrolled: Number(r.enrolled),
  }));
}

export type ProgramRow = {
  id: string;
  name: string;
  slug: string;
  track: string | null;
  subject: string | null;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  offerings: number;
  campuses: number;
};

export async function programs(): Promise<ProgramRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select p.id, p.name, p.slug, p.track, p.subject, p.description, p.image_url, p.active,
           count(c.id)::int                        as offerings,
           count(distinct c.school_id)::int        as campuses
      from programs p
      left join class_offerings c on c.program_id = p.id
     group by p.id
     order by p.track nulls last, p.name`;

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    track: (r.track as string) ?? null,
    subject: (r.subject as string) ?? null,
    description: (r.description as string) ?? null,
    imageUrl: (r.image_url as string) ?? null,
    active: Boolean(r.active),
    offerings: Number(r.offerings),
    campuses: Number(r.campuses),
  }));
}

export type TermRow = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  offerings: number;
  enrolled: number;
};

export async function terms(): Promise<TermRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select t.id, t.name, t.starts_on, t.ends_on, t.is_current,
           count(c.id)::int                     as offerings,
           coalesce(sum(c.seats_taken), 0)::int as enrolled
      from terms t
      left join class_offerings c on c.term_id = t.id
     group by t.id
     order by t.starts_on desc`;

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    startsOn: iso(r.starts_on),
    endsOn: iso(r.ends_on),
    isCurrent: Boolean(r.is_current),
    offerings: Number(r.offerings),
    enrolled: Number(r.enrolled),
  }));
}

export type OfferingRow = {
  id: string;
  title: string;
  status: string;
  school: string;
  schoolId: string;
  program: string;
  programId: string;
  term: string;
  termId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  firstSessionDate: string;
  lastSessionDate: string;
  capacity: number;
  seatsTaken: number;
  seatsLeft: number;
  priceCents: number | null;
  registrationMode: string;
  externalUrl: string | null;
  gradeMin: number | null;
  gradeMax: number | null;
  gradeLabel: string | null;
  location: string | null;
  specialNotes: string | null;
  sessionCount: number;
  cancelledCount: number;
  blackouts: string[];
  stripePriceId: string | null;
};

const OFFERING_SELECT = sql`
  select d.id, d.title, d.status, d.school_name, d.school_id, d.program_name, d.program_id,
         d.term_name, d.term_id, d.weekday, d.start_time, d.end_time,
         d.first_session_date, d.last_session_date, d.capacity, d.seats_taken, d.seats_left,
         d.price_cents, d.registration_mode, d.external_registration_url,
         d.grade_min, d.grade_max, d.grade_label, d.location, d.special_notes,
         d.session_count, d.cancelled_count, d.stripe_price_id,
         coalesce(array(select b.blackout_date from offering_blackouts b
                         where b.class_offering_id = d.id
                         order by b.blackout_date), '{}') as blackouts
    from offering_details d`;

function toOffering(r: Record<string, unknown>): OfferingRow {
  return {
    id: r.id as string,
    title: r.title as string,
    status: r.status as string,
    school: r.school_name as string,
    schoolId: r.school_id as string,
    program: r.program_name as string,
    programId: r.program_id as string,
    term: r.term_name as string,
    termId: r.term_id as string,
    weekday: Number(r.weekday),
    startTime: r.start_time as string,
    endTime: r.end_time as string,
    firstSessionDate: iso(r.first_session_date),
    lastSessionDate: iso(r.last_session_date),
    capacity: Number(r.capacity),
    seatsTaken: Number(r.seats_taken),
    seatsLeft: Number(r.seats_left),
    priceCents: r.price_cents === null ? null : Number(r.price_cents),
    registrationMode: r.registration_mode as string,
    externalUrl: (r.external_registration_url as string) ?? null,
    gradeMin: r.grade_min === null ? null : Number(r.grade_min),
    gradeMax: r.grade_max === null ? null : Number(r.grade_max),
    gradeLabel: (r.grade_label as string) ?? null,
    location: (r.location as string) ?? null,
    specialNotes: (r.special_notes as string) ?? null,
    sessionCount: Number(r.session_count ?? 0),
    cancelledCount: Number(r.cancelled_count ?? 0),
    blackouts: ((r.blackouts as unknown[]) ?? []).filter(Boolean).map(iso),
    stripePriceId: (r.stripe_price_id as string) ?? null,
  };
}

export async function offerings(): Promise<OfferingRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    ${OFFERING_SELECT} order by d.term_is_current desc, d.school_name, d.weekday, d.start_time`;
  return rows.map(toOffering);
}

export async function offering(id: string): Promise<OfferingRow | null> {
  const rows = await sql<Record<string, unknown>[]>`${OFFERING_SELECT} where d.id = ${id}`;
  return rows[0] ? toOffering(rows[0]) : null;
}

/** Every date a class has, so the editor can show what the schedule produced. */
export async function sessionsOf(offeringId: string) {
  const rows = await sql<Record<string, unknown>[]>`
    select id, seq, session_date, status, note, from_blackout, origin
      from sessions where class_offering_id = ${offeringId}
     order by session_date`;
  return rows.map((r) => ({
    id: r.id as string,
    seq: Number(r.seq),
    date: iso(r.session_date),
    status: r.status as string,
    note: (r.note as string) ?? null,
    fromBlackout: Boolean(r.from_blackout),
    origin: r.origin as string,
  }));
}

/** Who is in this class, for the "if you change this, N families are affected" line. */
export async function enrolledCount(offeringId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from enrollments
     where class_offering_id = ${offeringId} and status in ('active','cancellation_requested')`;
  return row?.n ?? 0;
}

export async function pickers() {
  const [s, p, t] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from schools where active order by name`,
    sql<{ id: string; name: string; track: string | null }[]>`
      select id, name, track from programs where active order by track nulls last, name`,
    sql<{ id: string; name: string; is_current: boolean }[]>`
      select id, name, is_current from terms order by starts_on desc`,
  ]);
  return { schools: s, programs: p, terms: t };
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}
