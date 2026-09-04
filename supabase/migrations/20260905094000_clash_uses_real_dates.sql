-- classes_clash was still doing date arithmetic with `weeks`.
--
-- That column is gone: a schedule is now a first date, a last date and a list
-- of holidays, because a term with three holidays in it does not run for the
-- number of weeks between its ends. Dropping the column left this function
-- referring to something that no longer exists, and every registration and
-- every signup started failing with "column y.weeks does not exist".
--
-- Worth saying plainly: nothing in Postgres complains when you drop a column a
-- function's body depends on. A function body is text until it runs, so the
-- error arrives at the first parent who tries to register rather than at the
-- migration. The test suite is what caught it, which is the argument for having
-- one that drives the real endpoints instead of asserting on units.
--
-- The rule itself is unchanged. Two offerings clash when they are on the same
-- weekday, their times overlap, and their date ranges overlap. It reads better
-- now, because "do these two ranges overlap" is what the data actually says
-- rather than something reconstructed from a start and a count.

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
       -- and the two runs have to overlap in the calendar
       and x.first_session_date <= y.last_session_date
       and y.first_session_date <= x.last_session_date
  );
$fn$;

comment on function classes_clash(uuid, uuid) is
  'True when two offerings run on the same weekday, at overlapping times, over '
  'overlapping date ranges. Half open on time, so back to back classes do not clash.';
