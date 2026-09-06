-- Tell a parent the difference between a seat that is gone and a seat that is
-- only being held.
--
-- `seats_taken` has always been the sum of two very different things: children
-- who are enrolled and paid for, and checkouts somebody opened minutes ago and
-- may well abandon. Collapsing them into one number is fine for the invariant,
-- which is what it was built for, and actively costs money on the parent side.
--
-- A class showing "Full" when two of its seats are ten minute holds is a class
-- that turns away families who would have bought a place, and the seat comes
-- back a few minutes later with nobody watching. That is a lead lost to a
-- rounding decision in a view.
--
-- So the view now reports the two halves, plus when the earliest hold lapses,
-- which is what lets a page say something useful: "full right now, but a held
-- seat could free up in about six minutes, check back".
--
--   seats_confirmed + seats_held = seats_taken     (the existing invariant)
--   seats_left = capacity - seats_taken            (unchanged)
--
-- Only live holds count. An expired hold is a seat the sweeper is about to hand
-- back, so counting it as held would tell a parent to wait for something that
-- has already happened.
--
-- Both counts come from a single lateral, so this adds one scan of two small
-- indexed tables per offering rather than two correlated subqueries per row.

create or replace view offering_details
with (security_invoker = true) as
select
  c.id,
  c.title,
  c.summary,
  c.status,
  c.weekday,
  c.start_time,
  c.end_time,
  c.first_session_date,
  c.last_session_date,
  c.capacity,
  c.seats_taken,
  greatest(c.capacity - c.seats_taken, 0)          as seats_left,
  c.price_cents,
  c.currency,
  c.registration_mode,
  c.external_registration_url,
  c.registration_opens_at,
  c.registration_closes_at,
  c.location,
  c.special_notes,
  c.grade_min,
  c.grade_max,
  c.stripe_price_id,
  c.stripe_product_id,

  s.id                                             as school_id,
  s.name                                           as school_name,
  s.slug                                           as school_slug,
  s.timezone                                       as school_timezone,
  s.kind                                           as school_kind,
  s.area                                           as school_area,
  s.logo_url                                       as school_logo_url,

  p.id                                             as program_id,
  p.name                                           as program_name,
  p.slug                                           as program_slug,
  p.track                                          as program_track,
  p.subject                                        as program_subject,
  p.description                                    as program_description,
  p.image_url                                      as program_image_url,

  t.id                                             as term_id,
  t.name                                           as term_name,
  t.is_current                                     as term_is_current,

  coalesce(x.scheduled, 0)                         as session_count,
  coalesce(x.cancelled, 0)                         as cancelled_count,
  x.first_scheduled_date,
  x.last_scheduled_date,
  x.next_session_at,

  case
    when c.grade_min is null then null
    when c.grade_min = c.grade_max then (case when c.grade_min = 0 then 'K' else c.grade_min::text end)
    else (case when c.grade_min = 0 then 'K' else c.grade_min::text end)
         || '-' ||
         (case when c.grade_max = 0 then 'K' else c.grade_max::text end)
  end                                              as grade_label,

  -- Appended rather than slotted in beside seats_left, where they belong
  -- logically. `create or replace view` can add columns at the end and cannot
  -- reorder or rename existing ones, and dropping the view would take every
  -- dependent object with it for a cosmetic gain.
  coalesce(h.confirmed, 0)                         as seats_confirmed,
  coalesce(h.held, 0)                              as seats_held,
  h.hold_expires_next
from class_offerings c
join schools  s on s.id = c.school_id
join programs p on p.id = c.program_id
join terms    t on t.id = c.term_id
left join lateral (
  select
    count(*) filter (where se.status = 'scheduled')::int              as scheduled,
    count(*) filter (where se.status = 'cancelled')::int              as cancelled,
    min(se.session_date) filter (where se.status = 'scheduled')       as first_scheduled_date,
    max(se.session_date) filter (where se.status = 'scheduled')       as last_scheduled_date,
    min(se.starts_at) filter (where se.status = 'scheduled'
                                and se.starts_at > now())             as next_session_at
  from sessions se
  where se.class_offering_id = c.id
) x on true
left join lateral (
  select
    (select count(*)::int from enrollments e
      where e.class_offering_id = c.id
        and e.status in ('active', 'cancellation_requested'))         as confirmed,
    (select count(*)::int from seat_holds sh
      where sh.class_offering_id = c.id
        and sh.expires_at > now())                                    as held,
    (select min(sh.expires_at) from seat_holds sh
      where sh.class_offering_id = c.id
        and sh.expires_at > now())                                    as hold_expires_next
) h on true;

grant select on offering_details to anon, authenticated;

comment on view offering_details is
  'Everything needed to describe one offering, joined and counted once. '
  'session_count is the number of sessions that will actually run, holidays '
  'already removed. seats_confirmed and seats_held are the two halves of '
  'seats_taken: paid places, and checkouts still in flight.';
