-- What their registration form actually asks for.
--
-- Taken field by field off the live Fillout definition, not from the brief.
-- Everything here is something their office has on a family today and would
-- lose the day they moved to this. The inventory is in
-- knowledge-base/11-their-real-system.md.

-- ---------------------------------------------------------------------------
-- Children. Grade rather than age, a photograph, and the two things the campus
-- needs to know before a child walks out of the door.
-- ---------------------------------------------------------------------------
alter table children
  add column grade                    smallint check (grade between 0 and 12),
  add column photo_path               text,
  add column in_afterschool_care      boolean not null default false,
  add column afterschool_care_program text,
  add column school_id                uuid references schools(id);

comment on column children.grade is
  'Kindergarten is 0, matching class_offerings.grade_min. Their form asks for '
  'grade and their classes are sold by grade; date of birth stays because it is '
  'what a medical form wants, but eligibility is decided on this.';

comment on column children.photo_path is
  'Object key in the private child-photos bucket. Never a URL: a URL in a '
  'column is a URL in a log, a backup and a support ticket. Reading one is a '
  'signed request that expires.';

comment on column children.in_afterschool_care is
  'A+ and W+ are the Hawaii after school care programs. It decides where a '
  'child is collected from, so it is on the record rather than in a notes '
  'field somebody has to read.';

-- ---------------------------------------------------------------------------
-- Parents gain the marketing answers their form collects, and which their
-- Brevo campaigns depend on.
-- ---------------------------------------------------------------------------
alter table parents
  add column marketing_opt_in boolean not null default false,
  add column heard_about_us   text;

-- ---------------------------------------------------------------------------
-- A second guardian. Their form asks for one and has nowhere structured to put
-- it; ours does, because "who else may collect this child" is an operational
-- question, not a free text note.
-- ---------------------------------------------------------------------------
create table guardians (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references parents(id) on delete cascade,
  full_name  text not null,
  email      citext,
  phone      text,
  relation   text,
  created_at timestamptz not null default now()
);
create index guardians_by_parent on guardians (parent_id);

-- ---------------------------------------------------------------------------
-- Consent.
--
-- Their form records agreement as a checkbox, which means the record is "this
-- box was ticked at some point, against whatever the policy said at the time".
-- That is not a consent record. What was agreed, which version of it, and when,
-- or it is worth nothing the first time somebody disputes a cancellation fee.
-- ---------------------------------------------------------------------------
create table consents (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid not null references parents(id) on delete cascade,
  kind           text not null check (kind in ('participation_policies','photo_release','marketing')),
  policy_version text not null,
  agreed_at      timestamptz not null default now(),
  order_id       uuid references orders(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index consents_by_parent on consents (parent_id, kind);
-- Agreeing to the same version twice is the same fact, not two.
create unique index consents_one_per_version on consents (parent_id, kind, policy_version);

-- ---------------------------------------------------------------------------
-- The attestation is per registration, not per family: it is a claim about one
-- child and one campus at one moment.
-- ---------------------------------------------------------------------------
alter table order_items
  add column attends_school_confirmed boolean not null default false;

comment on column order_items.attends_school_confirmed is
  'Their form makes a parent tick "my child is enrolled at the school where '
  'this runs" before paying. It is recorded against the purchase because that '
  'is what it is a claim about.';

-- ---------------------------------------------------------------------------
-- Row level security and grants.
-- ---------------------------------------------------------------------------
alter table guardians enable row level security;
alter table consents  enable row level security;

create policy parent_reads_own_guardians on guardians for select
  using (is_staff() or parent_id = (select id from parents where auth_user_id = auth.uid()));
create policy parent_writes_own_guardians on guardians for all
  using (parent_id = (select id from parents where auth_user_id = auth.uid()))
  with check (parent_id = (select id from parents where auth_user_id = auth.uid()));

create policy parent_reads_own_consents on consents for select
  using (is_staff() or parent_id = (select id from parents where auth_user_id = auth.uid()));
-- A consent can be given, never edited or withdrawn by rewriting history. If a
-- parent withdraws, that is a new row with a later version, not a delete.
create policy parent_gives_own_consent on consents for insert
  with check (parent_id = (select id from parents where auth_user_id = auth.uid()));

create policy staff_all_guardians on guardians for all using (is_staff()) with check (is_staff());
create policy staff_all_consents  on consents  for all using (is_staff()) with check (is_staff());

grant select, insert, update, delete on guardians to authenticated;
-- Insert is all a parent ever needs. Update and delete exist for staff, who
-- have to be able to correct a mistake; the policies above are what stop a
-- family reaching them.
grant select, insert, update, delete on consents to authenticated;
