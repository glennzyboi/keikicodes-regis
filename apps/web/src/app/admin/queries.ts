import { redirect } from "next/navigation";
import { currentStaff, type StaffMember } from "@/lib/staff-auth";
import { asUser } from "@keiki/core/rls";
import type { TransactionSql } from "postgres";

/**
 * Every read on this side goes through here, and every read runs as the signed
 * in staff member with row level security applied rather than as the database
 * owner. Remove someone from the staff table and these return nothing on their
 * next request, with no application level check to remember to write.
 */
export async function readAsStaff<T>(
  fn: (tx: TransactionSql, staff: StaffMember) => Promise<T>,
): Promise<{ staff: StaffMember; data: T }> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  const data = await asUser(staff.authUserId, (tx) => fn(tx, staff));
  return { staff, data };
}

export type Counts = {
  unconfirmed: number;
  cancellations: number;
  refunds: number;
  holds: number;
  classes: number;
  families: number;
  students: number;
  outbox: number;
};

/** The badge numbers on the rail. One query, so the nav cannot disagree with
 *  the page it links to. */
export async function navCounts(tx: TransactionSql): Promise<Counts> {
  const [row] = await tx<Counts[]>`
    select
      (select count(*)::int from orders
        where status = 'paid' and fulfilled_at is null) as unconfirmed,
      (select count(*)::int from enrollments
        where status = 'cancellation_requested') as cancellations,
      (select count(*)::int from enrollments
        where status = 'cancelled' and refund_owed) as refunds,
      (select count(*)::int from seat_holds) as holds,
      (select count(*)::int from class_offerings where status = 'published') as classes,
      (select count(*)::int from parents) as families,
      (select count(*)::int from children) as students,
      (select count(*)::int from notifications
        where status in ('queued','sending','failed')) as outbox`;
  return row;
}

export type UnconfirmedOrder = {
  order_id: string;
  amount_cents: number;
  created_at: Date;
  parent: string;
  email: string;
  minutes_waiting: number;
  payment_intent: string | null;
  children: number;
};

export function unconfirmedOrders(
  tx: TransactionSql,
  opts: { page?: number; perPage?: number } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<UnconfirmedOrder[]>`
    select o.id as order_id, o.amount_cents, o.created_at,
           p.full_name as parent, p.email,
           o.stripe_payment_intent_id as payment_intent,
           extract(epoch from (now() - o.created_at))::int / 60 as minutes_waiting,
           (select count(*)::int from order_items oi where oi.order_id = o.id) as children
      from orders o join parents p on p.id = o.parent_id
     where o.status = 'paid' and o.fulfilled_at is null
     order by o.created_at asc
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export type CancellationRequest = {
  enrollment_id: string;
  child: string;
  parent: string;
  email: string;
  title: string;
  school: string;
  paid_cents: number;
  requested_at: Date;
  sessions_total: number;
  sessions_remaining: number;
  has_payment: boolean;
  cancellation_reason_code: string | null;
  cancellation_reason: string | null;
  cancellation_note: string | null;
};

export type CancellationFilters = { reason?: string; school?: string };

export function cancellationRequests(
  tx: TransactionSql,
  opts: CancellationFilters & { page?: number; perPage?: number } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<CancellationRequest[]>`
    select e.id as enrollment_id,
           ch.first_name || ' ' || ch.last_name as child,
           p.full_name as parent, p.email, c.title, s.name as school,
           oi.unit_price_cents as paid_cents,
           coalesce(ev.created_at, e.created_at) as requested_at,
           (select count(*)::int from sessions ss
             where ss.class_offering_id = c.id and ss.status <> 'cancelled') as sessions_total,
           (select count(*)::int from sessions ss
             where ss.class_offering_id = c.id and ss.status = 'scheduled'
               and ss.starts_at >= now()) as sessions_remaining,
           (o.stripe_payment_intent_id is not null) as has_payment,
           e.cancellation_reason_code, e.cancellation_reason, e.cancellation_note
      from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
      join class_offerings c on c.id = e.class_offering_id
      join schools s on s.id = c.school_id
      join order_items oi on oi.id = e.order_item_id
      join orders o on o.id = oi.order_id
      left join lateral (
        select created_at from enrollment_events
         where enrollment_id = e.id and event = 'cancellation_requested'
         order by created_at desc limit 1) ev on true
     where e.status = 'cancellation_requested'
       and ${opts.reason ? tx`e.cancellation_reason_code = ${opts.reason}` : tx`true`}
       and ${opts.school ? tx`c.school_id = ${opts.school}::uuid` : tx`true`}
     order by requested_at asc
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

/**
 * Why families are actually leaving, counted.
 *
 * This is the question the reason codes were added for and the one their old
 * system could never answer: it recorded "requested by parent", which is not a
 * reason, so an office could approve refunds all term without ever learning
 * that most of them were the time clashing with something else.
 */
export async function cancellationReasonCounts(tx: TransactionSql) {
  return tx<{ code: string; label: string; n: number }[]>`
    select cancellation_reason_code as code,
           coalesce(cancellation_reason, cancellation_reason_code) as label,
           count(*)::int as n
      from enrollments
     where cancellation_reason_code is not null
     group by 1, 2
     order by n desc`;
}

export type RefundRow = {
  enrollment_id: string;
  child: string;
  parent: string;
  email: string;
  title: string;
  paid_cents: number;
  refund_amount_cents: number | null;
  refund_status: string | null;
  refund_error: string | null;
  stripe_refund_id: string | null;
  refund_owed: boolean;
  refunded_at: Date | null;
  cancelled_at: Date | null;
};

export type RefundFilters = { state?: string };

export function refundRows(
  tx: TransactionSql,
  opts: RefundFilters & { page?: number; perPage?: number } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<RefundRow[]>`
    select e.id as enrollment_id,
           ch.first_name || ' ' || ch.last_name as child,
           p.full_name as parent, p.email, c.title,
           oi.unit_price_cents as paid_cents,
           e.refund_amount_cents, e.refund_status, e.refund_error,
           e.stripe_refund_id, e.refund_owed, e.refunded_at, e.cancelled_at
      from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
      join class_offerings c on c.id = e.class_offering_id
      join order_items oi on oi.id = e.order_item_id
     where e.status = 'cancelled'
       and (e.refund_owed or e.refunded_at > now() - interval '30 days')
       and ${
         opts.state === "owed"
           ? tx`e.refund_owed`
           : opts.state === "failed"
             ? tx`e.refund_status = 'failed'`
             : opts.state === "done"
               ? tx`e.refund_status = 'succeeded'`
               : tx`true`
       }
     order by e.refund_owed desc, e.cancelled_at desc
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export type HoldRow = {
  hold_id: string;
  class_offering_id: string;
  parent_id: string;
  title: string;
  school: string;
  child: string;
  parent: string;
  minutes_left: number;
  order_status: string;
};

export type HoldFilters = { school?: string; state?: string };

/**
 * Shared by the rows and the count.
 *
 * "Protected" is a state rather than a status column: a hold whose order is
 * already paid, which the sweeper will never release however long it sits
 * there, because taking a seat back from a family who has paid is the one
 * failure that costs a place on the first day of term.
 */
function holdWhere(tx: TransactionSql, f: HoldFilters) {
  return tx`
        ${f.school ? tx`c.school_id = ${f.school}::uuid` : tx`true`}
    and ${
      f.state === "live"
        ? tx`(h.expires_at > now() and o.status <> 'paid')`
        : f.state === "expired"
          ? tx`(h.expires_at <= now() and o.status <> 'paid')`
          : f.state === "protected"
            ? tx`o.status = 'paid'`
            : tx`true`
    }`;
}

export function holdRows(
  tx: TransactionSql,
  opts: HoldFilters & { page?: number; perPage?: number } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<HoldRow[]>`
    select h.id as hold_id, c.id as class_offering_id, p.id as parent_id, c.title, s.name as school,
           ch.first_name || ' ' || ch.last_name as child,
           p.full_name as parent,
           o.status as order_status,
           extract(epoch from (h.expires_at - now()))::int / 60 as minutes_left
      from seat_holds h
      join order_items oi on oi.id = h.order_item_id
      join orders o on o.id = oi.order_id
      join parents p on p.id = o.parent_id
      join children ch on ch.id = oi.child_id
      join class_offerings c on c.id = h.class_offering_id
      join schools s on s.id = c.school_id
     where ${holdWhere(tx, opts)}
     order by h.expires_at asc
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export async function holdCount(tx: TransactionSql, f: HoldFilters = {}): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n
      from seat_holds h
      join order_items oi on oi.id = h.order_item_id
      join orders o on o.id = oi.order_id
      join class_offerings c on c.id = h.class_offering_id
     where ${holdWhere(tx, f)}`;
  return row.n;
}

export type ClassRow = {
  id: string;
  title: string;
  school: string;
  /** Needed wherever one class has to be told apart from the same curriculum at
   *  another campus, which on this catalogue is nearly everywhere. */
  weekday: number;
  timezone: string;
  capacity: number;
  seats_taken: number;
  enrolled: number;
  held: number;
  revenue_cents: number;
  sessions_left: number;
  next_session_id: string | null;
  next_session_at: Date | null;
  next_session_date: Date | string | null;
  next_session_seq: number | null;
  start_time: string;
  end_time: string;
  school_slug: string;
  school_id: string;
};

export function classRows(
  tx: TransactionSql,
  opts: { page?: number; perPage?: number; driftFirst?: boolean } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<ClassRow[]>`
    select c.id, c.title, s.name as school, s.slug as school_slug, s.id as school_id,
           s.timezone, c.capacity, c.seats_taken, c.weekday,
           c.start_time::text, c.end_time::text,
           (select count(*)::int from enrollments e
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as enrolled,
           (select count(*)::int from seat_holds h
             where h.class_offering_id = c.id) as held,
           (select coalesce(sum(oi.unit_price_cents), 0)::int
              from enrollments e join order_items oi on oi.id = e.order_item_id
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as revenue_cents,
           (select count(*)::int from sessions ss
             where ss.class_offering_id = c.id and ss.status = 'scheduled'
               and ss.starts_at >= now()) as sessions_left,
           nx.id as next_session_id, nx.starts_at as next_session_at,
           nx.session_date as next_session_date, nx.seq as next_session_seq
      from class_offerings c
      join schools s on s.id = c.school_id
      left join lateral (
        select id, starts_at, session_date, seq from sessions
         where class_offering_id = c.id and status = 'scheduled' and starts_at >= now()
         order by starts_at asc limit 1) nx on true
     where c.status = 'published'
     -- Drift first when asked. A dashboard's first page should hold the rows
     -- somebody has to do something about, not the alphabetically first ones.
     order by ${
       opts.driftFirst
         ? tx`((select count(*)::int from enrollments e
                 where e.class_offering_id = c.id
                   and e.status in ('active','cancellation_requested'))
             + (select count(*)::int from seat_holds h where h.class_offering_id = c.id)
             = c.seats_taken) asc,`
         : tx``
     } s.name, c.weekday
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx``}`;
}

export type ActivityRow = {
  id: string;
  event: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
  minutes_ago: number;
  child: string | null;
  parent: string | null;
};

/** The audit trail, read back as a feed. Every decision the office makes
 *  writes one of these, which is what makes "who cancelled this?" answerable. */
export function activity(tx: TransactionSql, limit = 12) {
  return tx<ActivityRow[]>`
    select ev.id, ev.event, ev.payload, ev.created_at,
           extract(epoch from (now() - ev.created_at))::int / 60 as minutes_ago,
           ch.first_name || ' ' || ch.last_name as child,
           p.full_name as parent
      from enrollment_events ev
      left join enrollments e on e.id = ev.enrollment_id
      left join children ch on ch.id = e.child_id
      left join parents p on p.id = ch.parent_id
     order by ev.created_at desc
     limit ${limit}`;
}

export type DayPoint = { day: string; registrations: number; revenue_cents: number };

/** Fourteen days of registrations, zero filled so the chart has no gaps. */
export function dailyRegistrations(tx: TransactionSql, days = 14) {
  return tx<DayPoint[]>`
    with span as (
      select generate_series(
        (now() at time zone 'Pacific/Honolulu')::date - ${days - 1}::int,
        (now() at time zone 'Pacific/Honolulu')::date,
        interval '1 day')::date as day
    )
    select to_char(span.day, 'YYYY-MM-DD') as day,
           count(e.id)::int as registrations,
           coalesce(sum(oi.unit_price_cents), 0)::int as revenue_cents
      from span
      left join enrollments e
        on (e.created_at at time zone 'Pacific/Honolulu')::date = span.day
       and e.status in ('active','cancellation_requested')
      left join order_items oi on oi.id = e.order_item_id
     group by span.day
     order by span.day`;
}

// ---------------------------------------------------------------------------
// Families and students
//
// The console started as five queues of things to decide, which is the right
// first cut but only half a product. The other half is being able to answer
// "what is going on with the Kealoha family" when one of them phones, without
// stitching it together from four screens.
// ---------------------------------------------------------------------------

export type FamilyRow = {
  parent_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  has_account: boolean;
  children: number;
  active_enrollments: number;
  lifetime_cents: number;
  open_issues: number;
  last_activity: Date | null;
};

/**
 * Families, a page at a time.
 *
 * The `limit 100` this replaces was not paging, it was a silent truncation: the
 * hundred and first family did not exist as far as the page was concerned, and
 * nothing said so. With 1,500 children across 20 schools that is a real family
 * nobody can find except through the search box.
 *
 * The count is a second query rather than a window function so the row query
 * stays exactly as it was and the count is not carried on every row.
 */
/**
 * What can be narrowed down on the family list.
 *
 * "Open issues" is the one that earns its place: a cancellation waiting on a
 * decision or a refund still owed. It is the difference between a list of
 * everybody and a list of the people somebody has to ring back.
 */
export type FamilyFilters = {
  search?: string;
  account?: string;
  issues?: string;
  school?: string;
};

function familyWhere(tx: TransactionSql, f: FamilyFilters) {
  const like = f.search ? `%${f.search.toLowerCase()}%` : null;
  return tx`
        ${
          like
            ? tx`(lower(p.full_name) like ${like}
                  or lower(p.email) like ${like}
                  or exists (select 1 from children ch
                              where ch.parent_id = p.id
                                and lower(ch.first_name || ' ' || ch.last_name) like ${like}))`
            : tx`true`
        }
    and ${
      f.account === "yes"
        ? tx`p.auth_user_id is not null`
        : f.account === "no"
          ? tx`p.auth_user_id is null`
          : tx`true`
    }
    and ${
      f.issues === "yes"
        ? tx`exists (select 1 from enrollments e
                      join children ch on ch.id = e.child_id
                     where ch.parent_id = p.id
                       and (e.status = 'cancellation_requested' or e.refund_owed))`
        : tx`true`
    }
    and ${
      f.school
        ? tx`exists (select 1 from enrollments e
                      join children ch on ch.id = e.child_id
                      join class_offerings c on c.id = e.class_offering_id
                     where ch.parent_id = p.id
                       and e.status in ('active','cancellation_requested')
                       and c.school_id = ${f.school}::uuid)`
        : tx`true`
    }`;
}

export async function familyCount(tx: TransactionSql, f: FamilyFilters = {}) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from parents p where ${familyWhere(tx, f)}`;
  return row.n;
}

export function familyRows(
  tx: TransactionSql,
  f: FamilyFilters = {},
  page = 1,
  perPage = 25,
  sort: "name" | "children" | "enrolled" | "lifetime" | "seen" = "seen",
  dir: "asc" | "desc" = "desc",
) {
  const asc = dir === "asc";
  return tx<FamilyRow[]>`
    select p.id as parent_id, p.full_name, p.email, p.phone,
           (p.auth_user_id is not null) as has_account,
           (select count(*)::int from children ch where ch.parent_id = p.id) as children,
           (select count(*)::int from enrollments e
              join children ch on ch.id = e.child_id
             where ch.parent_id = p.id
               and e.status in ('active','cancellation_requested')) as active_enrollments,
           (select coalesce(sum(o.amount_cents), 0)::int from orders o
             where o.parent_id = p.id and o.status = 'paid') as lifetime_cents,
           (select count(*)::int from enrollments e
              join children ch on ch.id = e.child_id
             where ch.parent_id = p.id
               and (e.status = 'cancellation_requested' or e.refund_owed)) as open_issues,
           greatest(
             (select max(o.created_at) from orders o where o.parent_id = p.id),
             p.created_at
           ) as last_activity
      from parents p
     where ${familyWhere(tx, f)}
     -- Allowlisted upstream by sortFrom(). Never interpolated from a raw
     -- query string, which is the one place a bound parameter cannot help.
     order by ${
       sort === "name"
         ? asc
           ? tx`p.full_name asc`
           : tx`p.full_name desc`
         : sort === "children"
           ? asc
             ? tx`children asc`
             : tx`children desc`
           : sort === "enrolled"
             ? asc
               ? tx`active_enrollments asc`
               : tx`active_enrollments desc`
             : sort === "lifetime"
               ? asc
                 ? tx`lifetime_cents asc`
                 : tx`lifetime_cents desc`
               : asc
                 ? tx`last_activity asc nulls last`
                 : tx`last_activity desc nulls last`
     }
     limit ${perPage} offset ${(page - 1) * perPage}`;
}

export type FamilyDetail = {
  parent_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  has_account: boolean;
  created_at: Date;
};

export function familyDetail(tx: TransactionSql, parentId: string) {
  return tx<FamilyDetail[]>`
    select id as parent_id, full_name, email, phone,
           (auth_user_id is not null) as has_account, created_at
      from parents where id = ${parentId}`;
}

export type ChildRow = {
  child_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  notes: string | null;
  grade: number | null;
  photo_path: string | null;
  in_afterschool_care: boolean;
  afterschool_care_program: string | null;
  parent_id: string;
  parent_name: string;
  parent_email: string;
  enrollments: number;
};

/**
 * What can be narrowed down on the student list.
 *
 * Chosen from what the office actually asks: which campus a child is at, what
 * grade they are in, whether they are enrolled in anything right now, whether
 * they go back to after school care (which changes the handover at the end of a
 * session), and whether there is a note on them that somebody should read
 * before a class starts.
 */
export type ChildFilters = {
  parentId?: string;
  search?: string;
  school?: string;
  grade?: string;
  enrolled?: string;
  care?: string;
  notes?: string;
};

/**
 * One where clause, shared by the rows and by the count.
 *
 * Two hand-kept copies of a filter is how "1 to 10 of 24" ends up describing a
 * different set from the ten rows above it.
 */
function childWhere(tx: TransactionSql, f: ChildFilters) {
  const like = f.search ? `%${f.search.toLowerCase()}%` : null;
  const grade = f.grade !== undefined && /^\d{1,2}$/.test(f.grade) ? Number(f.grade) : null;

  return tx`
        ${f.parentId ? tx`ch.parent_id = ${f.parentId}::uuid` : tx`true`}
    and ${
      like
        ? tx`(lower(ch.first_name || ' ' || ch.last_name) like ${like}
              or lower(p.email) like ${like})`
        : tx`true`
    }
    and ${grade === null ? tx`true` : tx`ch.grade = ${grade}`}
    and ${
      f.school
        ? tx`exists (select 1 from enrollments e
                      join class_offerings c on c.id = e.class_offering_id
                     where e.child_id = ch.id
                       and e.status in ('active','cancellation_requested')
                       and c.school_id = ${f.school}::uuid)`
        : tx`true`
    }
    and ${
      f.enrolled === "yes"
        ? tx`exists (select 1 from enrollments e
                      where e.child_id = ch.id
                        and e.status in ('active','cancellation_requested'))`
        : f.enrolled === "no"
          ? tx`not exists (select 1 from enrollments e
                            where e.child_id = ch.id
                              and e.status in ('active','cancellation_requested'))`
          : tx`true`
    }
    and ${f.care === "yes" ? tx`ch.in_afterschool_care` : tx`true`}
    and ${f.notes === "yes" ? tx`(ch.notes is not null and ch.notes <> '')` : tx`true`}`;
}

export async function childCount(tx: TransactionSql, f: ChildFilters = {}) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n
      from children ch join parents p on p.id = ch.parent_id
     where ${childWhere(tx, f)}`;
  return row.n;
}

export function childRows(
  tx: TransactionSql,
  opts: ChildFilters & {
    page?: number;
    perPage?: number;
    sort?: "name" | "born" | "family" | "classes";
    dir?: "asc" | "desc";
  } = {},
) {
  const perPage = opts.perPage ?? 25;
  const page = opts.page ?? 1;
  const asc = opts.dir === "asc";
  return tx<ChildRow[]>`
    select ch.id as child_id, ch.first_name, ch.last_name,
           to_char(ch.date_of_birth, 'YYYY-MM-DD') as date_of_birth, ch.notes,
           ch.grade, ch.photo_path, ch.in_afterschool_care, ch.afterschool_care_program,
           p.id as parent_id, p.full_name as parent_name, p.email as parent_email,
           (select count(*)::int from enrollments e
             where e.child_id = ch.id
               and e.status in ('active','cancellation_requested')) as enrollments
      from children ch
      join parents p on p.id = ch.parent_id
     where ${childWhere(tx, opts)}
     -- Chosen from a fixed set by sortFrom() before it gets here. A column name
     -- taken from a query string and interpolated is the one SQL injection a
     -- bound parameter cannot prevent, so the allowlist is the control.
     order by ${
       opts.sort === "born"
         ? asc
           ? tx`ch.date_of_birth asc`
           : tx`ch.date_of_birth desc`
         : opts.sort === "family"
           ? asc
             ? tx`p.full_name asc`
             : tx`p.full_name desc`
           : opts.sort === "classes"
             ? asc
               ? tx`enrollments asc`
               : tx`enrollments desc`
             : asc
               ? tx`ch.first_name asc, ch.last_name asc`
               : tx`ch.first_name desc, ch.last_name desc`
     }
     limit ${perPage} offset ${(page - 1) * perPage}`;
}

export type EnrollmentRow = {
  enrollment_id: string;
  status: string;
  child_id: string;
  child_name: string;
  grade: number | null;
  /** Medical and other notes. On the roster because it is needed before a
   *  session starts, not after somebody has gone looking for it. */
  notes: string | null;
  photo_path: string | null;
  in_afterschool_care: boolean;
  afterschool_care_program: string | null;
  parent_id: string;
  parent_name: string;
  parent_email: string;
  class_offering_id: string;
  title: string;
  school: string;
  timezone: string;
  weekday: number;
  start_time: string;
  price_cents: number;
  refund_owed: boolean;
  refund_status: string | null;
  order_id: string;
  paid_at: Date | null;
  starts_from_session_id: string | null;
  joined_late: boolean;
  created_at: Date;
};

export function enrollmentRows(
  tx: TransactionSql,
  opts: { parentId?: string; classOfferingId?: string } = {},
) {
  return tx<EnrollmentRow[]>`
    select e.id as enrollment_id, e.status, e.refund_owed, e.refund_status,
           ch.id as child_id, ch.first_name || ' ' || ch.last_name as child_name,
           ch.grade, ch.notes, ch.photo_path, ch.in_afterschool_care,
           ch.afterschool_care_program,
           p.id as parent_id, p.full_name as parent_name, p.email as parent_email,
           c.id as class_offering_id, c.title, sc.name as school, sc.timezone,
           c.weekday, c.start_time, oi.unit_price_cents as price_cents,
           o.id as order_id, o.fulfilled_at as paid_at,
           e.starts_from_session_id, e.created_at,
           (e.starts_from_session_id is not null
            and e.starts_from_session_id <> (
              select id from sessions s0
               where s0.class_offering_id = c.id
               order by s0.seq asc limit 1)) as joined_late
      from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
      join class_offerings c on c.id = e.class_offering_id
      join schools sc on sc.id = c.school_id
      join order_items oi on oi.id = e.order_item_id
      join orders o on o.id = oi.order_id
     where ${opts.parentId ? tx`ch.parent_id = ${opts.parentId}` : tx`true`}
       and ${opts.classOfferingId ? tx`c.id = ${opts.classOfferingId}` : tx`true`}
     order by e.created_at desc`;
}

export type PaymentRow = {
  order_id: string;
  parent_id: string;
  parent_name: string;
  email: string;
  amount_cents: number;
  status: string;
  created_at: Date;
  fulfilled_at: Date | null;
  payment_intent: string | null;
  items: number;
  classes: string[];
  refunded_cents: number;
};

export type LedgerFilters = {
  parentId?: string;
  classOfferingId?: string;
  status?: string;
  school?: string;
  search?: string;
};

/**
 * One where clause for the ledger, shared by the rows and by the count.
 *
 * The campus filter goes through `exists` rather than a join condition on the
 * `order_items` already joined above. That is deliberate: an order can buy
 * places at two campuses, and putting the campus on the join would drop the
 * other campus's line out of the same order's row, quietly changing what the
 * order says it was for.
 */
function ledgerWhere(tx: TransactionSql, f: LedgerFilters) {
  const like = f.search ? `%${f.search.toLowerCase()}%` : null;
  return tx`
        ${f.parentId ? tx`o.parent_id = ${f.parentId}::uuid` : tx`true`}
    and ${f.classOfferingId ? tx`oi.class_offering_id = ${f.classOfferingId}::uuid` : tx`true`}
    and ${f.status ? tx`o.status = ${f.status}` : tx`true`}
    and ${
      f.school
        ? tx`exists (select 1 from order_items oi2
                      join class_offerings c2 on c2.id = oi2.class_offering_id
                     where oi2.order_id = o.id and c2.school_id = ${f.school}::uuid)`
        : tx`true`
    }
    and ${
      like
        ? tx`(lower(p.full_name) like ${like} or lower(p.email) like ${like})`
        : tx`true`
    }`;
}

/** The money ledger. Every order, what it bought, and what came back. */
export function paymentRows(
  tx: TransactionSql,
  opts: LedgerFilters & {
    page?: number;
    perPage?: number;
  } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<PaymentRow[]>`
    select o.id as order_id, o.amount_cents, o.status, o.created_at, o.fulfilled_at,
           o.stripe_payment_intent_id as payment_intent,
           p.id as parent_id, p.full_name as parent_name, p.email,
           count(oi.id)::int as items,
           array_agg(distinct c.title) as classes,
           coalesce((select sum(e.refund_amount_cents)::int
                       from enrollments e
                       join order_items oi2 on oi2.id = e.order_item_id
                      where oi2.order_id = o.id
                        and e.refund_status = 'succeeded'), 0) as refunded_cents
      from orders o
      join parents p on p.id = o.parent_id
      join order_items oi on oi.order_id = o.id
      join class_offerings c on c.id = oi.class_offering_id
     where ${ledgerWhere(tx, opts)}
     group by o.id, p.id, p.full_name, p.email
     order by o.created_at desc
     -- Was a bare limit of 200, which is a silent truncation rather than
     -- paging, and the Money page summed this array for its Collected figure,
     -- so that number was already wrong past 200 orders. Totals now come from
     -- moneyTotals() over every row.
     ${perPage ? tx`limit ${perPage} offset ${(page - 1) * perPage}` : tx`limit 200`}`;
}

/**
 * How many are queued, sent and failed.
 *
 * The outbox page used to answer this by reading five hundred rows and counting
 * them in JavaScript, which is both slow and wrong: it is a count of the first
 * five hundred, not of everything, and it silently stops being true at 501.
 */
export async function notificationCounts(tx: TransactionSql) {
  const [row] = await tx<{ queued: number; sent: number; failed: number; total: number }[]>`
    select count(*) filter (where status = 'queued')::int as queued,
           count(*) filter (where status = 'sent')::int   as sent,
           count(*) filter (where status = 'failed')::int as failed,
           count(*)::int                                  as total
      from notifications`;
  return row;
}

export type NotificationRow = {
  id: string;
  template: string;
  channel: string;
  to_address: string;
  subject: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_for: Date;
  sent_at: Date | null;
  created_at: Date;
  parent_name: string | null;
  class_title: string | null;
};

export type NotificationFilters = {
  parentId?: string;
  status?: string;
  template?: string;
  channel?: string;
  search?: string;
};

/** Shared by the rows and the count, so the pager total cannot disagree. */
export function notificationWhere(tx: TransactionSql, f: NotificationFilters) {
  const like = f.search ? `%${f.search.toLowerCase()}%` : null;
  return tx`
        ${f.parentId ? tx`n.parent_id = ${f.parentId}::uuid` : tx`true`}
    and ${f.status ? tx`n.status = ${f.status}` : tx`true`}
    and ${f.template ? tx`n.template = ${f.template}` : tx`true`}
    and ${f.channel ? tx`n.channel = ${f.channel}` : tx`true`}
    and ${
      like
        ? tx`(lower(n.to_address) like ${like} or lower(coalesce(n.subject,'')) like ${like})`
        : tx`true`
    }`;
}

/** The distinct templates in use, so the filter never offers an empty one. */
export async function notificationTemplates(tx: TransactionSql) {
  const rows = await tx<{ template: string }[]>`
    select distinct template from notifications order by template`;
  return rows.map((r) => r.template);
}

export function notificationRows(
  tx: TransactionSql,
  opts: NotificationFilters & {
    limit?: number;
    page?: number;
    perPage?: number;
  } = {},
) {
  const perPage = opts.perPage ?? 0;
  const page = opts.page ?? 1;
  return tx<NotificationRow[]>`
    select n.id, n.template, n.channel, n.to_address, n.subject, n.status,
           n.attempts, n.last_error, n.scheduled_for, n.sent_at, n.created_at,
           p.full_name as parent_name, c.title as class_title
      from notifications n
      left join parents p on p.id = n.parent_id
      left join class_offerings c on c.id = n.class_offering_id
     where ${notificationWhere(tx, opts)}
     order by n.created_at desc
     ${
       perPage
         ? tx`limit ${perPage} offset ${(page - 1) * perPage}`
         : tx`limit ${opts.limit ?? 100}`
     }`;
}

export type SupportNote = {
  id: string;
  kind: string;
  body: string;
  author_email: string;
  created_at: Date;
  child_name: string | null;
};

export function supportNotes(tx: TransactionSql, parentId: string) {
  return tx<SupportNote[]>`
    select sn.id, sn.kind, sn.body, sn.author_email, sn.created_at,
           ch.first_name || ' ' || ch.last_name as child_name
      from support_notes sn
      left join children ch on ch.id = sn.child_id
     where sn.parent_id = ${parentId}
     order by sn.created_at desc`;
}

export type SessionRow = {
  session_id: string;
  seq: number;
  session_date: Date | string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  note: string | null;
  cancel_reason_code: string | null;
  rescheduled_from: string | null;
  origin: string;
  from_blackout: boolean;
  changed_by_name: string | null;
  title: string;
  school: string;
  school_slug: string;
  timezone: string;
  class_offering_id: string;
  start_time: string;
  end_time: string;
  enrolled: number;
};

export function sessionRows(
  tx: TransactionSql,
  opts: {
    classOfferingId?: string;
    upcomingOnly?: boolean;
    schoolId?: string;
    status?: string;
    limit?: number;
  } = {},
) {
  return tx<SessionRow[]>`
    select s.id as session_id, s.seq, s.session_date, s.starts_at, s.ends_at,
           s.status, s.note, s.cancel_reason_code, s.rescheduled_from,
           s.origin, s.from_blackout, st.full_name as changed_by_name,
           c.title, sc.name as school, sc.slug as school_slug, sc.timezone,
           c.id as class_offering_id, c.start_time::text, c.end_time::text,
           (select count(*)::int from enrollments e
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as enrolled
      from sessions s
      join class_offerings c on c.id = s.class_offering_id
      join schools sc on sc.id = c.school_id
      left join staff st on st.id = s.changed_by
     where ${opts.classOfferingId ? tx`c.id = ${opts.classOfferingId}` : tx`true`}
       and ${opts.upcomingOnly ? tx`s.starts_at >= now() - interval '1 day'` : tx`true`}
       and ${opts.schoolId ? tx`sc.id = ${opts.schoolId}` : tx`true`}
       and ${opts.status ? tx`s.status = ${opts.status}` : tx`true`}
     order by s.starts_at asc
     limit ${opts.limit ?? 400}`;
}

export function classDetail(tx: TransactionSql, classOfferingId: string) {
  return tx<ClassRow[]>`
    select c.id, c.title, sc.name as school, sc.timezone, c.capacity, c.seats_taken,
           (select count(*)::int from enrollments e
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as enrolled,
           (select count(*)::int from seat_holds h where h.class_offering_id = c.id) as held,
           (select coalesce(sum(oi.unit_price_cents), 0)::int
              from enrollments e join order_items oi on oi.id = e.order_item_id
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as revenue_cents,
           (select count(*)::int from sessions ss
             where ss.class_offering_id = c.id and ss.status = 'scheduled'
               and ss.starts_at >= now()) as sessions_left,
           nx.id as next_session_id, nx.starts_at as next_session_at
      from class_offerings c
      join schools sc on sc.id = c.school_id
      left join lateral (
        select id, starts_at from sessions
         where class_offering_id = c.id and status = 'scheduled' and starts_at >= now()
         order by starts_at asc limit 1) nx on true
     where c.id = ${classOfferingId}`;
}

// ---------------------------------------------------------------------------
// Totals
//
// These exist because of a real bug rather than for tidiness. The Money page
// computed "Collected" by summing the array it renders, and that array is
// capped at 200 rows, so the headline figure was already wrong past 200 orders
// and nothing said so. The overview does the same with classRows.
//
// Paginating those lists would have made it much worse. A total has to be a
// SUM in the database over every row, never a reduce over the page you happen
// to be showing.
// ---------------------------------------------------------------------------

export type MoneyTotals = {
  collected_cents: number;
  refunded_cents: number;
  paid_orders: number;
  ledger_rows: number;
};

export async function moneyTotals(tx: TransactionSql): Promise<MoneyTotals> {
  const [row] = await tx<MoneyTotals[]>`
    select coalesce(sum(o.amount_cents) filter (where o.status = 'paid'), 0)::int
             as collected_cents,
           -- Refunds live on the enrollment, not on a refunds table. This is
           -- the same expression paymentRows uses per row, summed over all of
           -- them rather than over the page being rendered.
           coalesce((select sum(e.refund_amount_cents)::int
                       from enrollments e
                      where e.refund_status = 'succeeded'), 0) as refunded_cents,
           count(*) filter (where o.status = 'paid')::int as paid_orders,
           count(*)::int as ledger_rows
      from orders o`;
  return row;
}

export type CapacityTotals = {
  classes: number;
  enrolled: number;
  capacity: number;
  held: number;
  revenue_cents: number;
  drifting: number;
};

export async function capacityTotals(tx: TransactionSql): Promise<CapacityTotals> {
  const [row] = await tx<CapacityTotals[]>`
    with per_class as (
      select c.id, c.capacity, c.seats_taken,
             (select count(*)::int from enrollments e
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested')) as enrolled,
             (select count(*)::int from seat_holds h
               where h.class_offering_id = c.id) as held,
             (select coalesce(sum(oi.unit_price_cents), 0)::int
                from enrollments e join order_items oi on oi.id = e.order_item_id
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested')) as revenue_cents
        from class_offerings c
       where c.status = 'published'
    )
    select count(*)::int                             as classes,
           coalesce(sum(enrolled), 0)::int           as enrolled,
           coalesce(sum(capacity), 0)::int           as capacity,
           coalesce(sum(held), 0)::int               as held,
           coalesce(sum(revenue_cents), 0)::int      as revenue_cents,
           count(*) filter (where enrolled + held <> seats_taken)::int as drifting
      from per_class`;
  return row;
}

/**
 * Row counts for the lists that page.
 *
 * One function rather than eleven, because every one of these is "how many rows
 * would that query return", and eleven near-identical exported names is eleven
 * chances for a page to call the wrong one.
 */
export async function countOf(
  tx: TransactionSql,
  what:
    | "unconfirmed"
    | "cancellations"
    | "refunds"
    | "ledger"
    | "holds"
    | "classes"
    | "notifications",
  opts: NotificationFilters & LedgerFilters = {},
): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from (
      ${
        what === "unconfirmed"
          ? // Was `status = 'pending' and stripe_checkout_session_id is not null`,
            // which is a different question from the one the Unconfirmed list
            // asks and a different one again from the rail badge. Three
            // definitions of one number, and the moment that list got a pager
            // the total above it would have disagreed with the rows inside it.
            // Money moved and fulfilment did not: that is the whole definition.
            tx`select o.id from orders o
                where o.status = 'paid' and o.fulfilled_at is null`
          : what === "cancellations"
            ? tx`select e.id from enrollments e where e.status = 'cancellation_requested'`
            : what === "refunds"
              ? tx`select e.id from enrollments e
                    where e.refund_owed or e.refunded_at is not null`
              : what === "ledger"
                ? // The same fragment the rows use, so the pager total is always
                  // a count of exactly what is being listed.
                  tx`select o.id from orders o
                      join parents p on p.id = o.parent_id
                      join order_items oi on oi.order_id = o.id
                     where ${ledgerWhere(tx, opts)}
                     group by o.id`
                : what === "holds"
                  ? tx`select h.id from seat_holds h`
                  : what === "classes"
                    ? tx`select c.id from class_offerings c where c.status = 'published'`
                    : // The same fragment the rows use, so the pager total is
                      // always a count of exactly what is being listed.
                      tx`select n.id from notifications n where ${notificationWhere(tx, opts)}`
      }
    ) x`;
  return row.n;
}
