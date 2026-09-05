-- Dropping out is not the same thing as asking for your money back.
--
-- The build spec calls these out separately and it is right to: "kids sometimes
-- join mid-semester, or drop" sits in a different sentence from cancellations
-- and refunds, because it is a different event.
--
-- A cancellation is a request from a family, waiting on a decision, and it
-- usually ends in money going back. A drop is an operational fact the office
-- records: the child stopped coming. Sometimes there is a refund, often there is
-- not (they came to eight of ten sessions), and frequently nobody asked for one
-- at all. Forcing that through the cancellation queue meant the office either
-- approved a refund it did not intend to give, or left a child on a roster and
-- a seat locked up for the rest of the term.
--
-- So: a fourth status, and the refund is a separate, optional decision rather
-- than something implied by the state.

alter table enrollments drop constraint if exists enrollments_status_check;
alter table enrollments add constraint enrollments_status_check
  check (status in ('active', 'cancellation_requested', 'cancelled', 'dropped'));

-- Why they left, and from when.
--
-- `dropped_from_session_id` is the mirror of `starts_from_session_id`, which is
-- how a mid-term join is already recorded. Together they give the office the
-- thing it actually needs on a roster: this child was with us from week 3 to
-- week 8. That is the number a pro-rata conversation starts from, and it is the
-- number their current system cannot produce at all.
alter table enrollments
  add column if not exists dropped_at            timestamptz,
  add column if not exists dropped_reason_code   text,
  add column if not exists dropped_note          text,
  add column if not exists dropped_by            text,
  add column if not exists dropped_from_session_id uuid references sessions(id);

comment on column enrollments.dropped_from_session_id is
  'The first session the child did not attend. Null means they never started.';

-- A dropped place is not an active one, so it must not hold a seat. The seat
-- counter is maintained by the application in the same transaction as the
-- status change, exactly as cancellation does; this index is what makes the
-- roster query that excludes them cheap.
create index if not exists enrollments_class_status_idx
  on enrollments (class_offering_id, status);
