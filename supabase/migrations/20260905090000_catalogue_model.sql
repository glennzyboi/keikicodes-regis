-- The catalogue, modelled on the business rather than on the demo.
--
-- Reading their live system changed what this has to hold. Evidence and
-- workings are in knowledge-base/11-their-real-system.md; the short version:
--
--  1. A program is a curriculum, reused across campuses. "Code Heroes: Virtual
--     Reality" runs at five schools on different days, for different grades, at
--     different prices. It was a text column on the class. It is a table now.
--
--  2. Over half their offerings are registered and paid for on the school's own
--     website, not theirs. Those must appear in the catalogue and must be
--     impossible to sell.
--
--  3. A schedule is a first date, a last date, a weekday and a list of dates
--     when there is no class. 25 of their 28 offerings have blackout dates.
--     "weeks" cannot express that, and the brief explicitly asks for it.
--
--  4. Grades, not ages. K-2, 4-6, 6-8. We were scraping ages out of prose.
--
--  5. A term is a thing with dates, not a string typed into a form filter.

-- ---------------------------------------------------------------------------
-- Programs. The curriculum, independent of where or when it runs.
-- ---------------------------------------------------------------------------
create table programs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  name        text not null,               -- 'Code Heroes: Virtual Reality'
  track       text,                        -- 'Code Heroes'  the level tier
  subject     text,                        -- 'Virtual Reality'
  description text,
  image_url   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index programs_slug_key on programs (slug);
create unique index programs_name_key on programs (lower(name));

comment on column programs.track is
  'Their naming already encodes a level: Explorers, Juniors, Heroes, Masters. '
  'Kept as its own column so a parent can be shown a ladder rather than a list.';

-- ---------------------------------------------------------------------------
-- Terms. Their Fillout form has the current term as a hardcoded record id and
-- the term name typed into two separate filter strings. Rolling to Spring means
-- editing a form in three places. Here it is a row with a flag.
-- ---------------------------------------------------------------------------
create table terms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                -- 'Fall 2026'
  starts_on  date not null,
  ends_on    date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint term_ends_after_start check (ends_on >= starts_on)
);
create unique index terms_name_key on terms (lower(name));
-- Exactly one term can be current. Enforced, not remembered.
create unique index terms_one_current on terms ((is_current)) where is_current;

-- ---------------------------------------------------------------------------
-- Schools gain the things their own records carry.
-- ---------------------------------------------------------------------------
alter table schools
  add column slug                     text,
  add column kind                     text check (kind in ('public','private','charter')),
  add column area                     text,
  add column logo_url                 text,
  add column active                   boolean not null default true,
  add column external_registration_url text;

-- Apostrophes and the Hawaiian okina come out rather than becoming separators,
-- so Wai'alae is waialae rather than wai-alae.
update schools set slug = regexp_replace(
  regexp_replace(lower(name), '[''‘’ʻʼ`]', '', 'g'),
  '[^a-z0-9]+', '-', 'g');
update schools set slug = regexp_replace(slug, '(^-|-$)', '', 'g');
alter table schools alter column slug set not null;
create unique index schools_slug_key on schools (slug);

comment on column schools.external_registration_url is
  'Where a family goes when this campus runs its own enrolment. Never used to '
  'take money here.';

-- ---------------------------------------------------------------------------
-- Offerings. A program, at a school, in a term.
-- ---------------------------------------------------------------------------
alter table class_offerings
  add column program_id               uuid references programs(id),
  add column term_id                  uuid references terms(id),
  add column grade_min                smallint,
  add column grade_max                smallint,
  add column last_session_date        date,
  add column registration_mode        text not null default 'keiki_coders'
                                        check (registration_mode in ('keiki_coders','external')),
  add column external_registration_url text,
  add column location                 text,
  add column special_notes            text,
  add column registration_closes_at   timestamptz;

comment on column class_offerings.grade_min is
  'Kindergarten is 0. Their ranges run K to 8, so a smallint covers it and '
  'sorts correctly, which a text label like "K-2" does not.';

comment on column class_offerings.title is
  'The offering label, which is not always the program name. Liholiho runs the '
  'same curriculum twice on one afternoon as "(A+ students only)" and "(non A+ '
  'students)". The program is the curriculum; this is what the family reads.';

-- ---------------------------------------------------------------------------
-- Backfill. Everything already in the table becomes a program and a term.
-- ---------------------------------------------------------------------------
insert into programs (slug, name)
select distinct
       regexp_replace(regexp_replace(lower(c.title), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'),
       c.title
  from class_offerings c
on conflict (lower(name)) do nothing;

insert into terms (name, starts_on, ends_on, is_current)
select c.term,
       min(c.first_session_date),
       max(c.first_session_date + (c.weeks * 7)),
       false
  from class_offerings c
 group by c.term
on conflict (lower(name)) do nothing;

update class_offerings c
   set program_id = p.id
  from programs p
 where lower(p.name) = lower(c.title) and c.program_id is null;

update class_offerings c
   set term_id = t.id
  from terms t
 where lower(t.name) = lower(c.term) and c.term_id is null;

update class_offerings
   set last_session_date = first_session_date + ((weeks - 1) * 7)
 where last_session_date is null;

-- Mark one term current so the catalogue has a default view.
update terms set is_current = true
 where id = (select id from terms order by starts_on desc limit 1);

alter table class_offerings
  alter column program_id set not null,
  alter column term_id set not null,
  alter column last_session_date set not null;

-- ---------------------------------------------------------------------------
-- The columns the new model replaces.
-- ---------------------------------------------------------------------------
alter table class_offerings drop column weeks;
alter table class_offerings drop column term;

-- An external offering has somewhere to send people; a sold one has a price.
alter table class_offerings alter column price_cents drop not null;
alter table class_offerings
  add constraint external_needs_a_destination check (
    registration_mode <> 'external' or external_registration_url is not null
  ),
  add constraint sold_here_needs_a_price check (
    registration_mode <> 'keiki_coders' or price_cents is not null
  ),
  add constraint session_window_is_ordered check (last_session_date >= first_session_date),
  add constraint grades_are_ordered check (
    grade_min is null or grade_max is null or grade_max >= grade_min
  ),
  -- The generator walks weekly from the first date. If that date is not on the
  -- class weekday the two disagree and nothing catches it, which is exactly the
  -- drift their spreadsheet has. The importer aligns the date; this makes sure.
  add constraint first_session_matches_weekday check (
    extract(dow from first_session_date)::int = weekday
  );

-- The natural key the seed and the importer upsert against. Now that term is a
-- foreign key rather than a string, the key has to travel with it, and the
-- title carries the campus qualifier so two variants at one school stay apart.
drop index if exists class_offerings_natural_key;
create unique index class_offerings_natural_key
  on class_offerings (school_id, term_id, lower(title));

-- ---------------------------------------------------------------------------
-- Blackout dates. A holiday is a property of the schedule, not an edit someone
-- remembered to make afterwards.
-- ---------------------------------------------------------------------------
create table offering_blackouts (
  id                uuid primary key default gen_random_uuid(),
  class_offering_id uuid not null references class_offerings(id) on delete cascade,
  blackout_date     date not null,
  reason            text,
  created_at        timestamptz not null default now(),
  unique (class_offering_id, blackout_date)
);

-- ---------------------------------------------------------------------------
-- Sessions become addressable by date rather than by position.
--
-- This is the fix for a real bug. Regeneration keyed on seq means that
-- shortening a term renumbers everything after it, so a cancellation recorded
-- against week 9 silently moves to a different afternoon. Sessions are now
-- unique on their date, and seq is a display ordinal derived from it.
-- ---------------------------------------------------------------------------
alter table sessions
  add column session_date date,
  add column origin text not null default 'generated'
    check (origin in ('generated','manual')),
  add column from_blackout boolean not null default false;

update sessions s
   set session_date = (s.starts_at at time zone sc.timezone)::date
  from class_offerings c
  join schools sc on sc.id = c.school_id
 where c.id = s.class_offering_id and s.session_date is null;

alter table sessions alter column session_date set not null;
create unique index sessions_by_date on sessions (class_offering_id, session_date);

-- seq is now derived, and a regeneration rewrites the whole run at once, so the
-- uniqueness check has to wait until the statement is finished.
alter table sessions drop constraint sessions_class_offering_id_seq_key;
alter table sessions add constraint sessions_class_offering_id_seq_key
  unique (class_offering_id, seq) deferrable initially deferred;

comment on column sessions.origin is
  'generated: produced by the schedule, and the schedule may change it. '
  'manual: put there by a human, usually a reschedule, and left alone.';

-- ---------------------------------------------------------------------------
-- Session generation.
--
-- Every weekday occurrence from the first date to the last, with blackout dates
-- present but cancelled, so a family sees "no class on 11 November" rather than
-- an unexplained gap in the calendar.
--
-- What it must never do is throw away a decision a human made. A session that
-- somebody cancelled by hand stays cancelled. A session added by a reschedule is
-- marked manual and is not touched. A date that falls out of the range is
-- deleted only when nothing references it, and cancelled with an explanation
-- when something does.
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

  -- Dropped explicitly as well as on commit: the importer calls this once per
  -- offering inside a single transaction, and the second call would otherwise
  -- find the first one's table still standing. Checked rather than "if exists",
  -- which is the same thing plus a notice on every single call.
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

  -- Add or retime every date the schedule asks for. Status is deliberately not
  -- in the update list: that is the human's column, not the generator's.
  insert into sessions (class_offering_id, session_date, seq, starts_at, ends_at,
                        status, note, origin, from_blackout)
  select o.id,
         w.session_date,
         0,
         ((w.session_date + o.start_time) at time zone tz),
         ((w.session_date + o.end_time)   at time zone tz),
         case when w.is_blackout then 'cancelled' else 'scheduled' end,
         case when w.is_blackout then coalesce(w.reason, 'No class') end,
         'generated',
         w.is_blackout
    from _wanted w
  on conflict (class_offering_id, session_date) do update
     set starts_at = excluded.starts_at,
         ends_at   = excluded.ends_at;

  -- A date that became a blackout is cancelled and says why.
  update sessions s
     set status = 'cancelled', from_blackout = true,
         note = coalesce(w.reason, 'No class')
    from _wanted w
   where s.class_offering_id = o.id
     and s.session_date = w.session_date
     and w.is_blackout
     and not s.from_blackout;

  -- A date whose blackout was withdrawn goes back to running. A session someone
  -- cancelled by hand is not a blackout, so it is untouched by this.
  update sessions s
     set status = 'scheduled', from_blackout = false, note = null
    from _wanted w
   where s.class_offering_id = o.id
     and s.session_date = w.session_date
     and not w.is_blackout
     and s.from_blackout;

  -- Dates that are no longer in the range at all. Anything a family's place is
  -- pinned to keeps its row, because deleting it would break their record; it
  -- is cancelled with a reason instead.
  delete from sessions s
   where s.class_offering_id = o.id
     and s.origin = 'generated'
     and not exists (select 1 from _wanted w where w.session_date = s.session_date)
     and not exists (select 1 from order_items oi where oi.starts_from_session_id = s.id)
     and not exists (select 1 from enrollments e  where e.starts_from_session_id = s.id)
     and not exists (select 1 from sessions r     where r.rescheduled_from = s.id);
  get diagnostics n_del = row_count;

  update sessions s
     set status = 'cancelled',
         note = coalesce(s.note, 'Removed when the schedule changed')
    from class_offerings c
   where c.id = o.id
     and s.class_offering_id = o.id
     and s.origin = 'generated'
     and s.status <> 'cancelled'
     and not exists (select 1 from _wanted w where w.session_date = s.session_date);

  -- Renumber. Deferred uniqueness is why this can be one statement.
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
-- Row level security for the new tables, and the grants that make it real.
-- Policies without grants are decoration; that lesson cost a day already.
-- ---------------------------------------------------------------------------
alter table programs           enable row level security;
alter table terms              enable row level security;
alter table offering_blackouts enable row level security;

create policy programs_are_public on programs for select using (true);
create policy terms_are_public    on terms    for select using (true);
create policy blackouts_follow_their_class on offering_blackouts for select using (
  exists (select 1 from class_offerings c
           where c.id = offering_blackouts.class_offering_id and c.status = 'published')
);

create policy staff_all_programs  on programs           for all using (is_staff()) with check (is_staff());
create policy staff_all_terms     on terms              for all using (is_staff()) with check (is_staff());
create policy staff_all_blackouts on offering_blackouts for all using (is_staff()) with check (is_staff());

grant select on programs, terms, offering_blackouts to anon, authenticated;
grant insert, update, delete on programs, terms, offering_blackouts to authenticated;
grant insert, update, delete on schools to authenticated;
