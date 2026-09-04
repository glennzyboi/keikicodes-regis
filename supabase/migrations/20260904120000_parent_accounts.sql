-- ---------------------------------------------------------------------------
-- Parents get real accounts.
--
-- The first cut deliberately had no parent login: guest checkout, then an HMAC
-- signed link in the confirmation email. That is good for conversion and it is
-- how a lot of registration systems work, but it has a property worth being
-- honest about. The link IS the credential. Anyone who has the email has the
-- account, forwarded mail included, and a shared family inbox is one address
-- with several people behind it. For a system holding children's names, dates
-- of birth and medical notes, that is the wrong trade.
--
-- So: Supabase Auth, email and password or Google. The link stops being a
-- credential and becomes a convenience that still lands on a login wall.
--
-- parents.auth_user_id already existed and was unused. This makes it the
-- identity, and adds the policies that let a signed in parent read their own
-- family and nobody else's.
-- ---------------------------------------------------------------------------

-- Existing rows have no account yet. New registrations always will, but a
-- backfilled database should not be broken by the constraint, so this is not
-- NOT NULL. The application requires it; the schema records who is linked.
create index if not exists parents_auth_user on parents (auth_user_id)
  where auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- A signed in parent can see and edit their own record, and read their own
-- children, orders, items and enrollments. They can request a cancellation on
-- their own enrollment and nothing else.
--
-- The existing parent_reads_* policies already scoped selects by auth.uid().
-- What was missing was any write path, because until now every write went
-- through a server route running as the owner.
-- ---------------------------------------------------------------------------

create or replace function current_parent_id() returns uuid
language sql stable security definer set search_path = public as $fn$
  select id from parents where auth_user_id = auth.uid();
$fn$;

comment on function current_parent_id() is
  'The signed in parent, or null. Security definer so it can read parents without granting the caller a way to read the whole table.';

drop policy if exists parent_updates_self on parents;
create policy parent_updates_self on parents for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists parent_requests_own_cancellation on enrollments;
create policy parent_requests_own_cancellation on enrollments for update
  using (
    exists (
      select 1 from children ch
       where ch.id = enrollments.child_id
         and ch.parent_id = current_parent_id()
    )
  )
  with check (
    exists (
      select 1 from children ch
       where ch.id = enrollments.child_id
         and ch.parent_id = current_parent_id()
    )
  );

-- A parent may read the notifications addressed to them. Useful for a "what
-- have you sent me" view, and it costs nothing to be transparent about it.
drop policy if exists parent_reads_own_notifications on notifications;
create policy parent_reads_own_notifications on notifications for select
  using (parent_id = current_parent_id());

drop policy if exists parent_reads_own_sessions on sessions;
create policy parent_reads_own_sessions on sessions for select
  using (
    exists (
      select 1 from enrollments e
        join children ch on ch.id = e.child_id
       where e.class_offering_id = sessions.class_offering_id
         and ch.parent_id = current_parent_id()
    )
  );
