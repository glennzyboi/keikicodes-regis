-- ---------------------------------------------------------------------------
-- Support notes.
--
-- The thing an office actually needs and that registration systems usually
-- forget: somewhere to write down what happened. A parent phones about a
-- clashing swim lesson, the office agrees to move the child next week, and
-- three days later a different staff member picks up the call.
--
-- Without this, that context lives in one person's inbox. With it, opening the
-- family shows the whole history: what they registered for, what they paid,
-- what we emailed them, and what we said on the phone.
--
-- Deliberately append only. A note is a record of what someone believed at the
-- time, so it is not editable; a correction is another note. Staff can delete
-- one they wrote by mistake, and nothing else.
-- ---------------------------------------------------------------------------

create table support_notes (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references parents(id) on delete cascade,
  -- Optional narrowing, so a note can be about one child or one class rather
  -- than the family in general.
  child_id    uuid references children(id) on delete set null,
  class_offering_id uuid references class_offerings(id) on delete set null,

  kind        text not null default 'note'
                check (kind in ('note', 'call', 'email', 'complaint', 'resolved')),
  body        text not null check (length(btrim(body)) > 0),

  author_id   uuid references staff(id) on delete set null,
  author_email text not null,

  created_at  timestamptz not null default now()
);

create index support_notes_by_parent on support_notes (parent_id, created_at desc);

comment on table support_notes is
  'Append only record of contact with a family. A correction is another note, never an edit.';

alter table support_notes enable row level security;

-- Staff only. A parent does not get to read the office notes about them, which
-- is a deliberate choice: staff will not write honestly in a field the subject
-- can read, and a sanitised note is worse than no note.
create policy staff_all_support_notes on support_notes
  for all using (is_staff()) with check (is_staff());

grant select, insert, update, delete on support_notes to authenticated;
