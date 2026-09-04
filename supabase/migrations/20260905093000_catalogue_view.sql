-- One place that knows how to describe an offering.
--
-- Before this, every page rebuilt the same join and the same arithmetic by
-- hand: school name, program name, seats left, how many weeks it runs. They
-- drifted, and one of them used a `weeks` column that stopped being true the
-- moment holidays became real. A ten week term with three holidays in it does
-- not run for ten weeks, and telling a parent it does is a small lie that ends
-- up in a support ticket.
--
-- So the count comes from the sessions that actually exist, and everything that
-- describes an offering is derived in one query that the whole app shares.
--
-- security_invoker means this view is not a way around row level security: it
-- runs as whoever selects from it, and the policies on the underlying tables
-- still apply. A view that bypassed them would be a hole with a friendly name.

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

  -- Derived from the rows that exist, not from a column somebody has to keep
  -- in step with them.
  coalesce(x.scheduled, 0)                         as session_count,
  coalesce(x.cancelled, 0)                         as cancelled_count,
  x.first_scheduled_date,
  x.last_scheduled_date,
  x.next_session_at,

  -- Grades as a label, worked out once. "K-2", "4-6", "1".
  case
    when c.grade_min is null then null
    when c.grade_min = c.grade_max then (case when c.grade_min = 0 then 'K' else c.grade_min::text end)
    else (case when c.grade_min = 0 then 'K' else c.grade_min::text end)
         || '-' ||
         (case when c.grade_max = 0 then 'K' else c.grade_max::text end)
  end                                              as grade_label
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
) x on true;

grant select on offering_details to anon, authenticated;

comment on view offering_details is
  'Everything needed to describe one offering, joined and counted once. '
  'session_count is the number of sessions that will actually run, holidays '
  'already removed.';
