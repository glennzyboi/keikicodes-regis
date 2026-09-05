-- Run the seat sweeper in the database, once a minute.
--
-- A seat held by somebody who opened Stripe and wandered off is a seat another
-- family could have had. Holds last thirty minutes, so a slow sweep is a real
-- cost, and "every minute, always" is the requirement.
--
-- It used to be a container on a schedule. That was the wrong home for it, for
-- two reasons that only became obvious once this was deployed:
--
--   1. The whole job is already one statement: select release_expired_holds().
--      Every safety property lives inside that function, including the one that
--      matters most, that it will not touch a hold whose order has been paid
--      (see 20260904080000_sweeper_never_touches_paid.sql). A container that
--      does nothing but call it is a second thing to deploy, watch and pay for,
--      wrapped around a rule that is already enforced where the data is.
--
--   2. A scheduler outside the database can be asleep. The web service on a
--      free plan sleeps after fifteen minutes of no traffic, which is exactly
--      when nobody is checking out and exactly when the holds are ageing.
--      pg_cron cannot be asleep while the database is up, and if the database
--      is down there is nothing to sweep.
--
-- Notifications and reminders stay outside: they call Resend over HTTP and
-- build message bodies from templates, so they are application work.
--
-- Written to be skippable. pg_cron has to be in shared_preload_libraries, and
-- a database where it is not should still accept every other migration rather
-- than refusing to start, so this reports and moves on.
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron unavailable (%), the sweeper will need an external schedule', sqlerrm;
    return;
end
$$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  -- Idempotent: a re-run replaces the schedule rather than adding a second one
  -- that does the same work twice a minute.
  perform cron.unschedule('release-expired-seat-holds')
   where exists (select 1 from cron.job where jobname = 'release-expired-seat-holds');

  perform cron.schedule(
    'release-expired-seat-holds',
    '* * * * *',
    'select release_expired_holds()'
  );
end
$$;
