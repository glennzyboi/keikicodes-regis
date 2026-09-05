import type { TransactionSql } from "postgres";

/**
 * Setup: the three reference records a class is assembled from.
 *
 * Rewritten from the catalogue's originals for two reasons.
 *
 * **They run as the signed in staff member now.** The old ones used the bare
 * owner connection while every other read in the console goes through
 * `readAsStaff`, so row level security was applied to thirteen queries and
 * skipped by three. The pages did check `currentStaff()` first so it was never
 * an open door, but "every read here runs as the person doing it" is the kind of
 * invariant that is only worth anything if it has no exceptions.
 *
 * **They filter, count and page in SQL.** The originals returned every row and
 * the page filtered the array in JavaScript, which is fine for 19 campuses and
 * is not a pattern to leave lying around in a system whose whole point is that
 * it will still work when the spreadsheet would not.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const like = (q: string | undefined) => (q?.trim() ? `%${q.trim().toLowerCase()}%` : null);

// ---------------------------------------------------------------------------
// Programs. A program is a curriculum; it runs as a class at several campuses.
// ---------------------------------------------------------------------------

export type ProgramListRow = {
  id: string;
  name: string;
  slug: string;
  track: string | null;
  subject: string | null;
  description: string | null;
  image_url: string | null;
  active: boolean;
  offerings: number;
  campuses: number;
  enrolled: number;
};

export type ProgramFilters = {
  id?: string;
  q?: string;
  track?: string;
  active?: string;
  school?: string;
};

export const PROGRAM_SORTS = ["name", "track", "classes", "campuses"] as const;
export type ProgramSort = (typeof PROGRAM_SORTS)[number];

function programWhere(tx: TransactionSql, f: ProgramFilters) {
  const l = like(f.q);
  return tx`
        ${f.id ? tx`p.id = ${f.id}::uuid` : tx`true`}
    and ${l ? tx`(lower(p.name) like ${l} or lower(coalesce(p.subject,'')) like ${l})` : tx`true`}
    and ${f.track ? tx`p.track = ${f.track}` : tx`true`}
    and ${
      f.active === "yes" ? tx`p.active` : f.active === "no" ? tx`not p.active` : tx`true`
    }
    and ${
      f.school
        ? tx`exists (select 1 from class_offerings c
                      where c.program_id = p.id and c.school_id = ${f.school}::uuid)`
        : tx`true`
    }`;
}

export function programList(
  tx: TransactionSql,
  f: ProgramFilters = {},
  opts: { page?: number; perPage?: number; sort?: ProgramSort; dir?: "asc" | "desc" } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  const asc = opts.dir === "asc";
  return tx<ProgramListRow[]>`
    select p.id, p.name, p.slug, p.track, p.subject, p.description, p.image_url, p.active,
           count(c.id)::int                          as offerings,
           count(distinct c.school_id)::int          as campuses,
           coalesce(sum(c.seats_taken), 0)::int      as enrolled
      from programs p
      left join class_offerings c on c.program_id = p.id
     where ${programWhere(tx, f)}
     group by p.id
     order by ${
       opts.sort === "track"
         ? asc
           ? tx`p.track asc nulls last, p.name`
           : tx`p.track desc nulls last, p.name`
         : opts.sort === "classes"
           ? asc
             ? tx`count(c.id) asc`
             : tx`count(c.id) desc`
           : opts.sort === "campuses"
             ? asc
               ? tx`count(distinct c.school_id) asc`
               : tx`count(distinct c.school_id) desc`
             : asc
               ? tx`p.name asc`
               : tx`p.name desc`
     }
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export async function programListCount(tx: TransactionSql, f: ProgramFilters = {}) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from programs p where ${programWhere(tx, f)}`;
  return row.n;
}

export async function programOne(tx: TransactionSql, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await programList(tx, { id }, { perPage: 1 });
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Campuses
// ---------------------------------------------------------------------------

export type CampusListRow = {
  id: string;
  name: string;
  slug: string;
  kind: string | null;
  area: string | null;
  timezone: string;
  logo_url: string | null;
  external_url: string | null;
  active: boolean;
  offerings: number;
  published: number;
  enrolled: number;
};

export type CampusFilters = {
  id?: string;
  q?: string;
  kind?: string;
  area?: string;
  active?: string;
};

export const CAMPUS_SORTS = ["name", "area", "classes", "enrolled"] as const;
export type CampusSort = (typeof CAMPUS_SORTS)[number];

function campusWhere(tx: TransactionSql, f: CampusFilters) {
  const l = like(f.q);
  return tx`
        ${f.id ? tx`s.id = ${f.id}::uuid` : tx`true`}
    and ${l ? tx`(lower(s.name) like ${l} or lower(coalesce(s.area,'')) like ${l})` : tx`true`}
    and ${f.kind ? tx`s.kind = ${f.kind}` : tx`true`}
    and ${f.area ? tx`s.area = ${f.area}` : tx`true`}
    and ${f.active === "yes" ? tx`s.active` : f.active === "no" ? tx`not s.active` : tx`true`}`;
}

export function campusList(
  tx: TransactionSql,
  f: CampusFilters = {},
  opts: { page?: number; perPage?: number; sort?: CampusSort; dir?: "asc" | "desc" } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  const asc = opts.dir === "asc";
  return tx<CampusListRow[]>`
    select s.id, s.name, s.slug, s.kind, s.area, s.timezone, s.logo_url,
           s.external_registration_url as external_url, s.active,
           count(c.id)::int                                      as offerings,
           count(c.id) filter (where c.status = 'published')::int as published,
           coalesce(sum(c.seats_taken), 0)::int                   as enrolled
      from schools s
      left join class_offerings c on c.school_id = s.id
     where ${campusWhere(tx, f)}
     group by s.id
     order by ${
       opts.sort === "area"
         ? asc
           ? tx`s.area asc nulls last, s.name`
           : tx`s.area desc nulls last, s.name`
         : opts.sort === "classes"
           ? asc
             ? tx`count(c.id) asc`
             : tx`count(c.id) desc`
           : opts.sort === "enrolled"
             ? asc
               ? tx`coalesce(sum(c.seats_taken), 0) asc`
               : tx`coalesce(sum(c.seats_taken), 0) desc`
             : asc
               ? tx`s.name asc`
               : tx`s.name desc`
     }
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export async function campusListCount(tx: TransactionSql, f: CampusFilters = {}) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from schools s where ${campusWhere(tx, f)}`;
  return row.n;
}

export async function campusOne(tx: TransactionSql, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await campusList(tx, { id }, { perPage: 1 });
  return row ?? null;
}

/** The distinct areas actually in use, for the area dropdown. */
export async function campusAreas(tx: TransactionSql) {
  const rows = await tx<{ area: string }[]>`
    select distinct area from schools where area is not null and area <> '' order by area`;
  return rows.map((r) => r.area);
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export type TermListRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  offerings: number;
  enrolled: number;
};

export type TermFilters = { id?: string; q?: string; when?: string };

export const TERM_SORTS = ["starts", "name", "classes"] as const;
export type TermSort = (typeof TERM_SORTS)[number];

function termWhere(tx: TransactionSql, f: TermFilters) {
  const l = like(f.q);
  return tx`
        ${f.id ? tx`t.id = ${f.id}::uuid` : tx`true`}
    and ${l ? tx`lower(t.name) like ${l}` : tx`true`}
    and ${
      f.when === "current"
        ? tx`t.is_current`
        : f.when === "past"
          ? tx`t.ends_on < current_date`
          : f.when === "upcoming"
            ? tx`t.starts_on > current_date`
            : tx`true`
    }`;
}

export function termList(
  tx: TransactionSql,
  f: TermFilters = {},
  opts: { page?: number; perPage?: number; sort?: TermSort; dir?: "asc" | "desc" } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  const asc = opts.dir === "asc";
  return tx<TermListRow[]>`
    select t.id, t.name,
           to_char(t.starts_on, 'YYYY-MM-DD') as starts_on,
           to_char(t.ends_on,   'YYYY-MM-DD') as ends_on,
           t.is_current,
           count(c.id)::int                     as offerings,
           coalesce(sum(c.seats_taken), 0)::int as enrolled
      from terms t
      left join class_offerings c on c.term_id = t.id
     where ${termWhere(tx, f)}
     group by t.id
     order by ${
       opts.sort === "name"
         ? asc
           ? tx`t.name asc`
           : tx`t.name desc`
         : opts.sort === "classes"
           ? asc
             ? tx`count(c.id) asc`
             : tx`count(c.id) desc`
           : asc
             ? tx`t.starts_on asc`
             : tx`t.starts_on desc`
     }
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export async function termListCount(tx: TransactionSql, f: TermFilters = {}) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from terms t where ${termWhere(tx, f)}`;
  return row.n;
}

export async function termOne(tx: TransactionSql, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await termList(tx, { id }, { perPage: 1 });
  return row ?? null;
}
