-- ---------------------------------------------------------------------------
-- Make row level security actually load bearing.
--
-- The initial schema enabled RLS and wrote policies, but never granted the
-- underlying table privileges to the anon and authenticated roles. A policy
-- only ever narrows what a grant already allows, so with no grant the policies
-- decided nothing: every read in the app went through the postgres superuser,
-- which bypasses RLS altogether. The rules were real on paper and inert in
-- practice.
--
-- These grants are deliberately coarse. The role level grant says "this role
-- may attempt to read this table"; the policy decides which rows come back.
-- That is the split Postgres is designed around, and it is why granting select
-- on parents to authenticated does not expose one family to another.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- The public catalogue. A parent browsing classes is not signed in to anything,
-- and published_classes_are_public keeps drafts out of the response.
grant select on schools, class_offerings, sessions to anon, authenticated;

-- Staff move seats and move class dates, and both go through this table.
-- release_seat() is a plain SQL function, so it runs with the caller's rights:
-- without this grant, approving a cancellation fails inside the function with
-- permission denied. staff_all_classes still decides who may actually do it.
grant insert, update, delete on class_offerings, sessions to authenticated;

-- Everything else is per-identity. Staff policies are "for all using
-- (is_staff())", so staff need the write grants too; a signed in parent holds
-- the same grants and is stopped by the policies, not by the grant.
grant select, insert, update, delete on
  parents, children, orders, order_items, enrollments, seat_holds,
  enrollment_events
  to authenticated;

grant select on staff to authenticated;

-- The staff table had RLS enabled and no policy at all, which is a correct
-- default deny but leaves staff unable to read their own record. is_staff() is
-- security definer so it never needed this; the admin header, which greets the
-- person signed in, does.
drop policy if exists staff_reads_staff on staff;
create policy staff_reads_staff on staff for select using (is_staff());
