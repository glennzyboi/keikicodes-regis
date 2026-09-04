import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { asUser } from "@/lib/rls";
import { formatMoney } from "@/lib/stripe";
import {
  approveCancellation,
  declineCancellation,
  markRefunded,
  signOut,
} from "./actions";
import { SessionControls } from "./session-controls";

export const dynamic = "force-dynamic";

type Attention = {
  order_id: string;
  amount_cents: number;
  created_at: Date;
  parent: string;
  email: string;
  minutes_waiting: number;
};

type Requested = {
  enrollment_id: string;
  child: string;
  parent: string;
  email: string;
  title: string;
  price_cents: number;
  requested_at: Date;
};

type Refund = {
  enrollment_id: string;
  child: string;
  parent: string;
  title: string;
  price_cents: number;
};

type Hold = {
  title: string;
  child: string;
  expires_at: Date;
  minutes_left: number;
};

type ClassRow = {
  id: string;
  title: string;
  school: string;
  timezone: string;
  capacity: number;
  seats_taken: number;
  enrolled: number;
  held: number;
  next_session_id: string | null;
  next_session_at: Date | null;
};

function when(d: Date, timezone = "Pacific/Honolulu") {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
}

export default async function Admin() {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");

  // Every read below runs as the signed in staff user with RLS on, not as the
  // database owner. Remove their row from staff and this page empties out.
  const data = await asUser(staff.authUserId, async (tx) => {
    const attention = await tx<Attention[]>`
      select o.id as order_id, o.amount_cents, o.created_at,
             p.full_name as parent, p.email,
             extract(epoch from (now() - o.created_at))::int / 60 as minutes_waiting
        from orders o
        join parents p on p.id = o.parent_id
       where o.status = 'paid' and o.fulfilled_at is null
       order by o.created_at asc`;

    const requested = await tx<Requested[]>`
      select e.id as enrollment_id,
             ch.first_name || ' ' || ch.last_name as child,
             p.full_name as parent, p.email,
             c.title, c.price_cents,
             coalesce(ev.created_at, e.created_at) as requested_at
        from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
        join class_offerings c on c.id = e.class_offering_id
        left join lateral (
          select created_at from enrollment_events
           where enrollment_id = e.id and event = 'cancellation_requested'
           order by created_at desc limit 1) ev on true
       where e.status = 'cancellation_requested'
       order by requested_at asc`;

    const refunds = await tx<Refund[]>`
      select e.id as enrollment_id,
             ch.first_name || ' ' || ch.last_name as child,
             p.full_name as parent, c.title, c.price_cents
        from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
        join class_offerings c on c.id = e.class_offering_id
       where e.status = 'cancelled' and e.refund_owed and e.refunded_at is null
       order by e.cancelled_at asc`;

    const holds = await tx<Hold[]>`
      select c.title,
             ch.first_name || ' ' || ch.last_name as child,
             h.expires_at,
             extract(epoch from (h.expires_at - now()))::int / 60 as minutes_left
        from seat_holds h
        join order_items oi on oi.id = h.order_item_id
        join children ch on ch.id = oi.child_id
        join class_offerings c on c.id = h.class_offering_id
       order by h.expires_at asc`;

    const classes = await tx<ClassRow[]>`
      select c.id, c.title, s.name as school, s.timezone, c.capacity, c.seats_taken,
             (select count(*)::int from enrollments e
               where e.class_offering_id = c.id and e.status in ('active','cancellation_requested')) as enrolled,
             (select count(*)::int from seat_holds h where h.class_offering_id = c.id) as held,
             nx.id as next_session_id, nx.starts_at as next_session_at
        from class_offerings c
        join schools s on s.id = c.school_id
        left join lateral (
          select id, starts_at from sessions
           where class_offering_id = c.id and status = 'scheduled' and starts_at >= now()
           order by starts_at asc limit 1) nx on true
       where c.status = 'published'
       order by s.name, c.weekday`;

    return { attention, requested, refunds, holds, classes };
  });

  const needsEyes = data.attention.length + data.requested.length + data.refunds.length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="kc-eyebrow">Office</span>
          <h1 className="mt-4 font-display text-4xl font-bold text-green-900">
            {needsEyes === 0 ? (
              <>
                Everything is <span className="kc-highlight">settled</span>
              </>
            ) : (
              <>
                {needsEyes} thing{needsEyes === 1 ? " needs" : "s need"} you
              </>
            )}
          </h1>
          <p className="mt-3 text-ink-soft">
            Signed in as {staff.fullName}. This page reads through the same row level
            security a parent hits, as {staff.email}.
          </p>
        </div>
        <form action={signOut}>
          <button className="kc-btn kc-btn-quiet text-sm">Sign out</button>
        </form>
      </div>

      {/* Paid but not fulfilled. The one queue that means money moved and the
          system has not caught up, so it goes first and it is never hidden. */}
      <Section
        title="Paid but not confirmed"
        blurb="Money has moved and fulfilment has not finished. Stripe retries for three days on its own, so this list normally empties itself. Anything sitting here for more than a few minutes is worth opening."
        count={data.attention.length}
        empty="Nothing waiting. Every payment taken has been confirmed."
      >
        {data.attention.map((o) => (
          <Row key={o.order_id}>
            <div>
              <p className="font-display font-semibold text-green-900">{o.parent}</p>
              <p className="text-sm text-ink-soft">{o.email}</p>
            </div>
            <div className="text-right">
              <p className="font-display font-bold text-green-900">
                {formatMoney(o.amount_cents)}
              </p>
              <p className="text-sm text-sun-deep">
                waiting {o.minutes_waiting} minute{o.minutes_waiting === 1 ? "" : "s"}
              </p>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Cancellations to decide"
        blurb="The seat is still held while you decide, so nobody else can take it. Approving is the only thing that gives the place back."
        count={data.requested.length}
        empty="No open requests."
      >
        {data.requested.map((r) => (
          <Row key={r.enrollment_id}>
            <div>
              <p className="font-display font-semibold text-green-900">
                {r.child} in {r.title}
              </p>
              <p className="text-sm text-ink-soft">
                {r.parent}, asked {when(new Date(r.requested_at))}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-bold text-green-900">
                {formatMoney(r.price_cents)}
              </span>
              <form action={declineCancellation}>
                <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                <button className="kc-btn kc-btn-quiet text-sm">Keep the place</button>
              </form>
              <form action={approveCancellation}>
                <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                <button className="kc-btn kc-btn-primary text-sm">
                  Approve and free the seat
                </button>
              </form>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Refunds to pay out"
        blurb="Cancelled and owed money back. Refund in Stripe, then mark it here. The flag stays until someone does, so a refund cannot be quietly forgotten."
        count={data.refunds.length}
        empty="Nothing owed."
      >
        {data.refunds.map((r) => (
          <Row key={r.enrollment_id}>
            <div>
              <p className="font-display font-semibold text-green-900">
                {r.child} in {r.title}
              </p>
              <p className="text-sm text-ink-soft">{r.parent}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display font-bold text-green-900">
                {formatMoney(r.price_cents)}
              </span>
              <form action={markRefunded}>
                <input type="hidden" name="enrollmentId" value={r.enrollment_id} />
                <button className="kc-btn kc-btn-quiet text-sm">Mark refunded</button>
              </form>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Seats being held"
        blurb="Parents part way through checkout. These return to the pool on their own when the hold expires, and never while the order is paid."
        count={data.holds.length}
        empty="No checkouts in progress."
      >
        {data.holds.map((h, i) => (
          <Row key={i}>
            <div>
              <p className="font-display font-semibold text-green-900">
                {h.child} in {h.title}
              </p>
            </div>
            <p className="text-sm text-ink-soft">
              {h.minutes_left > 0
                ? `${h.minutes_left} minute${h.minutes_left === 1 ? "" : "s"} left`
                : "expired, next sweep returns it"}
            </p>
          </Row>
        ))}
      </Section>

      <h2 className="mt-14 font-display text-2xl font-bold text-green-900">Classes</h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">
        Enrolled plus held should always equal seats taken. If it ever does not, the
        counter and the records have drifted and that is a bug worth chasing.
      </p>

      <div className="mt-6 space-y-3">
        {data.classes.map((c) => {
          const reconciles = c.enrolled + c.held === c.seats_taken;
          return (
            <div key={c.id} className="kc-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
                    {c.school}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-bold text-green-900">
                    {c.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-soft">
                    {c.next_session_at
                      ? `Next class ${when(new Date(c.next_session_at), c.timezone)}`
                      : "No sessions left this term"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-bold text-green-900">
                    {c.seats_taken}
                    <span className="text-base text-ink-soft">/{c.capacity}</span>
                  </p>
                  <p className={`text-sm ${reconciles ? "text-ink-soft" : "text-sun-deep"}`}>
                    {c.enrolled} enrolled, {c.held} held
                    {reconciles ? "" : ", does not reconcile"}
                  </p>
                </div>
              </div>

              {c.next_session_id && (
                <SessionControls
                  sessionId={c.next_session_id}
                  label={when(new Date(c.next_session_at!), c.timezone)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  blurb,
  count,
  empty,
  children,
}: {
  title: string;
  blurb: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold text-green-900">{title}</h2>
        {count > 0 && (
          <span className="rounded-full bg-sun px-2.5 py-0.5 font-display text-sm font-bold text-green-900">
            {count}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">{blurb}</p>
      {count === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-hairline px-5 py-6 text-sm text-ink-soft">
          {empty}
        </p>
      ) : (
        <div className="mt-4 space-y-3">{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="kc-card flex flex-wrap items-center justify-between gap-4 p-5">
      {children}
    </div>
  );
}
