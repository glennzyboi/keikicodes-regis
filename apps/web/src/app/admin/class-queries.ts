import type { TransactionSql } from "postgres";

/**
 * The Classes workspace: one list, several front doors.
 *
 * `/admin/classes`, a campus page and a program page all render this with a
 * different filter pre-applied. That is what makes "no repetition" true in the
 * code rather than only in the plan: there is one query and one component, so
 * the three views cannot disagree about what a class is or how full it is.
 *
 * It reads from `offering_details`, the view that already assembles a class
 * with its campus, program and term, rather than re-joining them by hand. The
 * two queries this replaces did that join twice, slightly differently, which is
 * exactly how the catalogue's list and the roster list ended up sorting classes
 * into different orders and showing different session counts.
 *
 * The whole model in one line: **a program is a curriculum, an offering is one
 * instance of it at one campus in one term.** Their own catalogue is 28
 * offerings across 13 program names, with "Code Heroes: Virtual Reality"
 * running at five different campuses, each with its own grades, weekday, price
 * and holidays. So the school is a filter on this list, not a folder above it.
 */

export type ClassFilters = {
  /** One class by id. What the detail page's header uses. */
  id?: string;
  q?: string;
  school?: string;
  term?: string;
  program?: string;
  track?: string;
  status?: string;
  mode?: string;
  weekday?: string;
  fill?: string;
};

export type ClassListRow = {
  id: string;
  title: string;
  status: string;
  school: string;
  school_id: string;
  school_slug: string;
  school_logo_url: string | null;
  timezone: string;
  program: string;
  program_id: string;
  track: string | null;
  subject: string | null;
  program_image_url: string | null;
  term: string;
  term_id: string;
  term_is_current: boolean;
  weekday: number;
  start_time: string;
  end_time: string;
  grade_label: string | null;
  location: string | null;
  capacity: number;
  seats_taken: number;
  seats_left: number;
  price_cents: number | null;
  registration_mode: string;
  enrolled: number;
  held: number;
  revenue_cents: number;
  session_count: number;
  sessions_left: number;
  first_session_date: Date | string;
  last_session_date: Date | string;
  next_session_at: Date | null;
};

/**
 * The filter, as one reusable SQL fragment.
 *
 * Shared by the rows and by the count, so "1 to 10 of 24" can never describe a
 * different set from the ten rows above it. Two hand-kept copies of a where
 * clause is the classic way that goes wrong, and it is the kind of bug people
 * report forever afterwards.
 *
 * Every value here is a bound parameter. The only thing ever interpolated is
 * the sort, and that goes through the allowlist below.
 */
function classWhere(tx: TransactionSql, f: ClassFilters) {
  const like = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const weekday = f.weekday && /^[0-6]$/.test(f.weekday) ? Number(f.weekday) : null;

  return tx`
        ${f.id ? tx`d.id = ${f.id}::uuid` : tx`true`}
    and ${
          like
            ? tx`(lower(d.title) like ${like}
                  or lower(d.school_name) like ${like}
                  or lower(d.program_name) like ${like})`
            : tx`true`
        }
    and ${f.school ? tx`d.school_id = ${f.school}::uuid` : tx`true`}
    and ${f.term ? tx`d.term_id = ${f.term}::uuid` : tx`true`}
    and ${f.program ? tx`d.program_id = ${f.program}::uuid` : tx`true`}
    and ${f.track ? tx`d.program_track = ${f.track}` : tx`true`}
    and ${f.status ? tx`d.status = ${f.status}` : tx`true`}
    and ${f.mode ? tx`d.registration_mode = ${f.mode}` : tx`true`}
    and ${weekday === null ? tx`true` : tx`d.weekday = ${weekday}`}
    and ${
      f.fill === "open"
        ? tx`(d.seats_left > 0 and d.registration_mode = 'keiki_coders')`
        : f.fill === "full"
          ? tx`(d.seats_left <= 0 and d.registration_mode = 'keiki_coders')`
          : f.fill === "empty"
            ? tx`d.seats_taken = 0`
            : f.fill === "drift"
              ? tx`(
                    (select count(*)::int from enrollments e
                      where e.class_offering_id = d.id
                        and e.status in ('active','cancellation_requested'))
                  + (select count(*)::int from seat_holds h
                      where h.class_offering_id = d.id)
                  <> d.seats_taken)`
              : tx`true`
    }`;
}

export const CLASS_SORTS = [
  "default",
  "title",
  "campus",
  "when",
  "filled",
  "price",
  "starts",
] as const;
export type ClassSort = (typeof CLASS_SORTS)[number];

export function classList(
  tx: TransactionSql,
  f: ClassFilters,
  opts: { page?: number; perPage?: number; sort?: ClassSort; dir?: "asc" | "desc" } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  const asc = opts.dir === "asc";

  return tx<ClassListRow[]>`
    select d.id, d.title, d.status,
           d.school_name as school, d.school_id, d.school_slug,
           d.school_logo_url, d.school_timezone as timezone,
           d.program_name as program, d.program_id, d.program_track as track,
           d.program_subject as subject, d.program_image_url,
           d.term_name as term, d.term_id, d.term_is_current,
           d.weekday, d.start_time::text, d.end_time::text, d.grade_label, d.location,
           d.capacity, d.seats_taken, d.seats_left, d.price_cents, d.registration_mode,
           d.session_count, d.first_session_date, d.last_session_date, d.next_session_at,
           (select count(*)::int from enrollments e
             where e.class_offering_id = d.id
               and e.status in ('active','cancellation_requested'))  as enrolled,
           (select count(*)::int from seat_holds h
             where h.class_offering_id = d.id)                       as held,
           (select coalesce(sum(oi.unit_price_cents), 0)::int
              from enrollments e join order_items oi on oi.id = e.order_item_id
             where e.class_offering_id = d.id
               and e.status in ('active','cancellation_requested'))  as revenue_cents,
           (select count(*)::int from sessions ss
             where ss.class_offering_id = d.id and ss.status = 'scheduled'
               and ss.starts_at >= now())                            as sessions_left
      from offering_details d
     where ${classWhere(tx, f)}
     order by ${
       opts.sort === "title"
         ? asc
           ? tx`d.title asc`
           : tx`d.title desc`
         : opts.sort === "campus"
           ? asc
             ? tx`d.school_name asc, d.weekday asc`
             : tx`d.school_name desc, d.weekday asc`
           : opts.sort === "when"
             ? asc
               ? tx`d.weekday asc, d.start_time asc`
               : tx`d.weekday desc, d.start_time desc`
             : opts.sort === "filled"
               ? asc
                 ? tx`(d.seats_taken::numeric / greatest(d.capacity, 1)) asc`
                 : tx`(d.seats_taken::numeric / greatest(d.capacity, 1)) desc`
               : opts.sort === "price"
                 ? asc
                   ? tx`d.price_cents asc nulls last`
                   : tx`d.price_cents desc nulls last`
                 : opts.sort === "starts"
                   ? asc
                     ? tx`d.first_session_date asc`
                     : tx`d.first_session_date desc`
                   : // The term somebody is actually fielding calls about, then
                     // the way an office reads a timetable: campus, day, time.
                     tx`d.term_is_current desc, d.school_name, d.weekday, d.start_time`
     }
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export async function classListCount(tx: TransactionSql, f: ClassFilters): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from offering_details d where ${classWhere(tx, f)}`;
  return row.n;
}

/**
 * Everything the dropdowns need, in one round trip.
 *
 * Built from what is actually in the catalogue rather than from a fixed list,
 * so the campus filter never offers a campus with no classes and produces an
 * empty page, and a new program appears the moment somebody adds one.
 */
export async function classFilterOptions(tx: TransactionSql) {
  const [schools, programs, terms, tracks] = await Promise.all([
    tx<{ id: string; name: string }[]>`
      select s.id, s.name from schools s
       where exists (select 1 from class_offerings c where c.school_id = s.id)
       order by s.name`,
    tx<{ id: string; name: string }[]>`
      select p.id, p.name from programs p
       where exists (select 1 from class_offerings c where c.program_id = p.id)
       order by p.name`,
    tx<{ id: string; name: string; is_current: boolean }[]>`
      select id, name, is_current from terms order by starts_on desc`,
    tx<{ track: string }[]>`
      select distinct track from programs where track is not null order by track`,
  ]);

  return {
    schools,
    programs,
    terms,
    tracks: tracks.map((t) => t.track),
    currentTermId: terms.find((t) => t.is_current)?.id ?? null,
  };
}

/**
 * One class, for the header every tab of the detail page shares.
 *
 * Deliberately the same shape as a list row, so the card on the list and the
 * header on the detail page are fed by one type and cannot drift apart. It
 * reuses the list query with an id filter rather than loading the list and
 * picking one out in JavaScript, which is the version of this that works fine
 * on 28 classes and falls over on 2,800.
 */
export async function classHeader(
  tx: TransactionSql,
  id: string,
): Promise<ClassListRow | null> {
  // A UUID cast on a value that is not one raises rather than returning empty,
  // and a bad id in a URL is a 404, not a 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await classList(tx, { id }, { perPage: 1 });
  return row ?? null;
}
