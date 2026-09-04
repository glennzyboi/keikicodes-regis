-- ---------------------------------------------------------------------------
-- Schedule conflicts.
--
-- A child cannot be in two places at once, and until now nothing stopped a
-- parent booking Scratch Adventures and Python Starters when both run Tuesdays
-- at 3pm. The registration would succeed, the money would be taken, and the
-- problem would surface on the first day of term with a child in a corridor.
--
-- Two offerings clash when all three are true:
--
--   1. same weekday
--   2. their time windows overlap
--   3. their term date ranges overlap
--
-- The third matters. A Tuesday 3pm class that finished in the spring does not
-- clash with a Tuesday 3pm class starting in the autumn, and a rule that only
-- looked at weekday and time would refuse a perfectly good registration.
--
-- Time overlap is half open: a class ending at 4pm and one starting at 4pm do
-- not clash. Back to back is tight but it is a decision a parent is allowed to
-- make, and treating it as a conflict would be the system inventing a policy.
-- ---------------------------------------------------------------------------

create or replace function classes_clash(a uuid, b uuid) returns boolean
language sql stable as $fn$
  select exists (
    select 1
      from class_offerings x, class_offerings y
     where x.id = a
       and y.id = b
       and x.id <> y.id
       and x.weekday = y.weekday
       -- half open overlap, so 3-4pm and 4-5pm are fine
       and x.start_time < y.end_time
       and y.start_time < x.end_time
       -- and the terms have to actually run at the same time of year
       and x.first_session_date
             <= y.first_session_date + (y.weeks * 7)
       and y.first_session_date
             <= x.first_session_date + (x.weeks * 7)
  );
$fn$;

comment on function classes_clash(uuid, uuid) is
  'True when two offerings run on the same weekday, at overlapping times, in overlapping terms. Half open on time, so back to back classes do not clash.';

-- ---------------------------------------------------------------------------
-- Everything a given child already holds that would clash with a candidate
-- class. Returned as rows so the caller can name the offending class rather
-- than saying "there is a conflict" and leaving the parent to guess.
-- ---------------------------------------------------------------------------
create or replace function clashing_enrollments(p_child uuid, p_class uuid)
returns table (
  enrollment_id uuid,
  class_offering_id uuid,
  title text,
  school text,
  weekday int,
  start_time time,
  end_time time
)
language sql stable as $fn$
  select e.id, c.id, c.title, s.name, c.weekday, c.start_time, c.end_time
    from enrollments e
    join class_offerings c on c.id = e.class_offering_id
    join schools s on s.id = c.school_id
   where e.child_id = p_child
     and e.status in ('active', 'cancellation_requested')
     and classes_clash(c.id, p_class);
$fn$;

comment on function clashing_enrollments(uuid, uuid) is
  'Live places for this child that clash with the candidate class, named so the message can say which one.';
