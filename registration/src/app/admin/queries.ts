import { redirect } from "next/navigation";
import { currentStaff, type StaffMember } from "@/lib/staff-auth";
import { asUser } from "@/lib/rls";
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
      (select count(*)::int from class_offerings where status = 'published') as classes`;
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
