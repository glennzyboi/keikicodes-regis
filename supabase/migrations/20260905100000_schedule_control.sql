-- ---------------------------------------------------------------------------
-- Schedule control.
--
-- "Cancel next class" and "Move next class" were two buttons that only ever
-- acted on the single next date, took a free text note, and in the case of the
-- move did not work at all: the 5 September migration made session_date NOT
-- NULL and the reschedule insert never set it, so every move threw. Nothing
-- caught it because no test moved a class.
--
-- What an office actually needs is the whole term under its hands: cancel any
-- date, move any date to any date and time, shift a run of dates when the term
-- slips, add a make up class, and put back something cancelled by mistake.
-- Every one of those is a decision somebody will be asked about in February, so
-- each one is recorded with a reason and an author rather than a sentence typed
-- into a note field.
-- ---------------------------------------------------------------------------

-- Why a date stopped. A code because the office reports on these, and a note
-- because no fixed list survives contact with a real school year.
alter table sessions
  add column cancel_reason_code text
    check (cancel_reason_code in
      ('holiday','instructor_unavailable','campus_closed','weather',
       'low_enrollment','facility','other')),
  add column changed_at timestamptz,
  add column changed_by uuid references staff(id);

comment on column sessions.cancel_reason_code is
  'Why this date is not running. Set for cancelled and rescheduled rows. '
  'from_blackout rows carry holiday, set by generate_sessions.';

-- Blackouts are holidays by definition, so the existing ones get the code
-- rather than being left null and looking like unexplained cancellations.
update sessions set cancel_reason_code = 'holiday' where from_blackout;
update sessions set cancel_reason_code = 'other'
 where status in ('cancelled','rescheduled') and cancel_reason_code is null;

-- ---------------------------------------------------------------------------
-- The audit trail.
--
-- Same shape and same reasoning as enrollment_events: append only, so a
-- correction is another row rather than an edit that quietly rewrites what the
-- office believed last Tuesday. This is the table that answers "who moved week
-- nine, and when did the families find out".
-- ---------------------------------------------------------------------------
create table session_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  event      text not null
               check (event in ('cancelled','restored','moved','added','note_changed')),
  reason_code text,
  note       text,
  actor_id   uuid references staff(id),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index session_events_by_session on session_events (session_id, created_at desc);

alter table session_events enable row level security;
create policy staff_all_session_events on session_events
  for all using (is_staff()) with check (is_staff());

-- Parents see why their own class moved. Same join the sessions policy uses.
create policy parent_reads_own_session_events on session_events for select using (
  exists (
    select 1
      from sessions s
      join enrollments e on e.class_offering_id = s.class_offering_id
      join children ch   on ch.id = e.child_id
     where s.id = session_events.session_id
       and ch.parent_id = current_parent_id()
       and e.status in ('active','cancellation_requested')
  )
);

grant select on session_events to authenticated;
grant insert on session_events to authenticated;

-- ---------------------------------------------------------------------------
-- A parent's reason for cancelling.
--
-- cancellation_reason was a single free text column that the code filled with
-- the literal string 'requested by parent', which records nothing. A code the
-- office can count, plus the family's own words, is the difference between
-- "eleven cancellations this term" and "eleven cancellations, seven of them
-- because the time clashed with something".
-- ---------------------------------------------------------------------------
alter table enrollments
  add column cancellation_reason_code text
    check (cancellation_reason_code in
      ('schedule_conflict','child_not_enjoying','moved_away','cost',
       'illness','wrong_class','other')),
  add column cancellation_note text,
  add column cancellation_requested_at timestamptz;

-- ---------------------------------------------------------------------------
-- generate_sessions, corrected on two counts found while building the editor.
--
--   1. A rescheduled row is the historical record of a move. Shrinking the term
--      used to overwrite its status with 'cancelled', which broke the chain
--      between the original date and its replacement.
--   2. A manual row (a make up class, or the far end of a move) is already
--      excluded from deletion, and now says so in one place rather than by
--      accident in three.
-- ---------------------------------------------------------------------------
create or replace function generate_sessions(p_offering uuid)
returns table (scheduled int, cancelled int, removed int)
language plpgsql as $fn$
declare
  o     class_offerings%rowtype;
  tz    text;
  n_del int := 0;
begin
  select * into o from class_offerings where id = p_offering;
  if not found then
    raise exception 'generate_sessions: no offering %', p_offering;
  end if;
  select s.timezone into tz from schools s where s.id = o.school_id;

  if to_regclass('pg_temp._wanted') is not null then
    execute 'drop table _wanted';
  end if;
  create temporary table _wanted on commit drop as
  select d::date                                              as session_date,
         b.id is not null                                     as is_blackout,
         b.reason                                             as reason
    from generate_series(o.first_session_date, o.last_session_date, interval '1 day') g(d)
    left join offering_blackouts b
           on b.class_offering_id = o.id and b.blackout_date = d::date
   where extract(dow from d)::int = o.weekday;

  insert into sessions (class_offering_id, session_date, seq, starts_at, ends_at,
                        status, note, origin, from_blackout, cancel_reason_code)
  select o.id,
         w.session_date,
         0,
         ((w.session_date + o.start_time) at time zone tz),
         ((w.session_date + o.end_time)   at time zone tz),
         case when w.is_blackout then 'cancelled' else 'scheduled' end,
         case when w.is_blackout then coalesce(w.reason, 'No class') end,
         'generated',
         w.is_blackout,
         case when w.is_blackout then 'holiday' end
    from _wanted w
  on conflict (class_offering_id, session_date) do update
     set starts_at = excluded.starts_at,
         ends_at   = excluded.ends_at;

  update sessions s
     set status = 'cancelled', from_blackout = true,
         cancel_reason_code = 'holiday',
         note = coalesce(w.reason, 'No class')
    from _wanted w
   where s.class_offering_id = o.id
     and s.session_date = w.session_date
     and w.is_blackout
     and not s.from_blackout;

  update sessions s
     set status = 'scheduled', from_blackout = false, note = null,
         cancel_reason_code = null
    from _wanted w
   where s.class_offering_id = o.id
     and s.session_date = w.session_date
     and not w.is_blackout
     and s.from_blackout;

  delete from sessions s
   where s.class_offering_id = o.id
     and s.origin = 'generated'
     and not exists (select 1 from _wanted w where w.session_date = s.session_date)
     and not exists (select 1 from order_items oi where oi.starts_from_session_id = s.id)
     and not exists (select 1 from enrollments e  where e.starts_from_session_id = s.id)
     and not exists (select 1 from sessions r     where r.rescheduled_from = s.id);
  get diagnostics n_del = row_count;

  -- 'rescheduled' is excluded deliberately. That row is the record of a move,
  -- and turning it into a plain cancellation loses which date it moved to.
  update sessions s
     set status = 'cancelled',
         cancel_reason_code = coalesce(s.cancel_reason_code, 'other'),
         note = coalesce(s.note, 'Removed when the schedule changed')
    from class_offerings c
   where c.id = o.id
     and s.class_offering_id = o.id
     and s.origin = 'generated'
     and s.status = 'scheduled'
     and not exists (select 1 from _wanted w where w.session_date = s.session_date);

  update sessions s
     set seq = r.rn
    from (select id, row_number() over (order by session_date) as rn
            from sessions where class_offering_id = o.id) r
   where s.id = r.id and s.seq is distinct from r.rn;

  return query
  select count(*) filter (where s.status = 'scheduled')::int,
         count(*) filter (where s.status = 'cancelled')::int,
         n_del
    from sessions s where s.class_offering_id = o.id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Renumbering after a hand edit.
--
-- The editor adds and removes single dates without regenerating the whole run,
-- and seq is a display ordinal, so week 7 must still read as week 7 after a
-- make up class is inserted in the middle. Deferred uniqueness is what lets
-- this be one statement.
-- ---------------------------------------------------------------------------
create or replace function renumber_sessions(p_offering uuid)
returns int
language plpgsql as $fn$
declare n int;
begin
  update sessions s
     set seq = r.rn
    from (select id, row_number() over (order by session_date) as rn
            from sessions where class_offering_id = p_offering) r
   where s.id = r.id and s.seq is distinct from r.rn;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function renumber_sessions(uuid) from public;
grant execute on function renumber_sessions(uuid) to authenticated;
