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

export function unconfirmedOrders(tx: TransactionSql) {
  return tx<UnconfirmedOrder[]>`
    select o.id as order_id, o.amount_cents, o.created_at,
           p.full_name as parent, p.email,
           o.stripe_payment_intent_id as payment_intent,
           extract(epoch from (now() - o.created_at))::int / 60 as minutes_waiting,
           (select count(*)::int from order_items oi where oi.order_id = o.id) as children
      from orders o join parents p on p.id = o.parent_id
     where o.status = 'paid' and o.fulfilled_at is null
     order by o.created_at asc`;
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
};

export function cancellationRequests(tx: TransactionSql) {
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
           (o.stripe_payment_intent_id is not null) as has_payment
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
     order by requested_at asc`;
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

export function refundRows(tx: TransactionSql) {
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
     order by e.refund_owed desc, e.cancelled_at desc`;
}

export type HoldRow = {
  title: string;
  school: string;
  child: string;
  parent: string;
  minutes_left: number;
  order_status: string;
};

export function holdRows(tx: TransactionSql) {
  return tx<HoldRow[]>`
    select c.title, s.name as school,
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
     order by h.expires_at asc`;
}

export type ClassRow = {
  id: string;
  title: string;
  school: string;
  timezone: string;
  capacity: number;
  seats_taken: number;
  enrolled: number;
  held: number;
  revenue_cents: number;
  sessions_left: number;
  next_session_id: string | null;
  next_session_at: Date | null;
};

export function classRows(tx: TransactionSql) {
  return tx<ClassRow[]>`
    select c.id, c.title, s.name as school, s.timezone, c.capacity, c.seats_taken,
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
           nx.id as next_session_id, nx.starts_at as next_session_at
      from class_offerings c
      join schools s on s.id = c.school_id
      left join lateral (
        select id, starts_at from sessions
         where class_offering_id = c.id and status = 'scheduled' and starts_at >= now()
         order by starts_at asc limit 1) nx on true
     where c.status = 'published'
     order by s.name, c.weekday`;
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

export function familyRows(tx: TransactionSql, search?: string) {
  const like = search ? `%${search.toLowerCase()}%` : null;
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
     where ${
       like
         ? tx`(lower(p.full_name) like ${like}
               or lower(p.email) like ${like}
               or exists (select 1 from children ch
                           where ch.parent_id = p.id
                             and lower(ch.first_name || ' ' || ch.last_name) like ${like}))`
         : tx`true`
     }
     order by last_activity desc nulls last
     limit 100`;
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

export function childRows(tx: TransactionSql, opts: { parentId?: string; search?: string } = {}) {
  const like = opts.search ? `%${opts.search.toLowerCase()}%` : null;
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
     where ${opts.parentId ? tx`ch.parent_id = ${opts.parentId}` : tx`true`}
       and ${
         like
           ? tx`(lower(ch.first_name || ' ' || ch.last_name) like ${like}
                 or lower(p.email) like ${like})`
           : tx`true`
       }
     order by p.full_name, ch.first_name
     limit 200`;
}

export type EnrollmentRow = {
  enrollment_id: string;
  status: string;
  child_id: string;
  child_name: string;
  grade: number | null;
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
           ch.grade, ch.photo_path, ch.in_afterschool_care, ch.afterschool_care_program,
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

/** The money ledger. Every order, what it bought, and what came back. */
export function paymentRows(
  tx: TransactionSql,
  opts: { parentId?: string; classOfferingId?: string; status?: string } = {},
) {
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
     where ${opts.parentId ? tx`o.parent_id = ${opts.parentId}` : tx`true`}
       and ${opts.classOfferingId ? tx`oi.class_offering_id = ${opts.classOfferingId}` : tx`true`}
       and ${opts.status ? tx`o.status = ${opts.status}` : tx`true`}
     group by o.id, p.id, p.full_name, p.email
     order by o.created_at desc
     limit 200`;
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

export function notificationRows(
  tx: TransactionSql,
  opts: { parentId?: string; status?: string; limit?: number } = {},
) {
  return tx<NotificationRow[]>`
    select n.id, n.template, n.channel, n.to_address, n.subject, n.status,
           n.attempts, n.last_error, n.scheduled_for, n.sent_at, n.created_at,
           p.full_name as parent_name, c.title as class_title
      from notifications n
      left join parents p on p.id = n.parent_id
      left join class_offerings c on c.id = n.class_offering_id
     where ${opts.parentId ? tx`n.parent_id = ${opts.parentId}` : tx`true`}
       and ${opts.status ? tx`n.status = ${opts.status}` : tx`true`}
     order by n.created_at desc
     limit ${opts.limit ?? 100}`;
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
  starts_at: Date;
  ends_at: Date;
  status: string;
  note: string | null;
  rescheduled_from: string | null;
  title: string;
  school: string;
  timezone: string;
  class_offering_id: string;
  enrolled: number;
};

export function sessionRows(
  tx: TransactionSql,
  opts: { classOfferingId?: string; upcomingOnly?: boolean } = {},
) {
  return tx<SessionRow[]>`
    select s.id as session_id, s.seq, s.starts_at, s.ends_at, s.status, s.note,
           s.rescheduled_from, c.title, sc.name as school, sc.timezone,
           c.id as class_offering_id,
           (select count(*)::int from enrollments e
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as enrolled
      from sessions s
      join class_offerings c on c.id = s.class_offering_id
      join schools sc on sc.id = c.school_id
     where ${opts.classOfferingId ? tx`c.id = ${opts.classOfferingId}` : tx`true`}
       and ${opts.upcomingOnly ? tx`s.starts_at >= now() - interval '1 day'` : tx`true`}
     order by s.starts_at asc
     limit 300`;
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
