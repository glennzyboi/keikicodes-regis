-- ---------------------------------------------------------------------------
-- The notifications outbox.
--
-- Every message this system sends is written to a table first, in the same
-- transaction as the thing that caused it, and delivered afterwards by a
-- worker. Nothing calls an email API inline.
--
-- Why it is worth a table rather than an await:
--
--   1. A cancelled session and the email telling families about it must either
--      both happen or neither. If sending is inline and the transaction rolls
--      back, forty parents have been told about a cancellation that did not
--      happen. If sending is inline and the API is down, the class is cancelled
--      and nobody knows.
--   2. Delivery fails for boring reasons. A row can be retried with backoff;
--      an await that threw is gone.
--   3. Staff can see what was sent, to whom, and whether it landed. "Did the
--      Tuesday parents get the holiday notice?" is a question the office asks,
--      and it should be answerable without opening a third party dashboard.
--
-- dedupe_key is the part that makes reminders safe. Running the reminder job
-- twice, or running it on two machines, cannot send a family the same reminder
-- twice, because the second insert loses to a unique index.
-- ---------------------------------------------------------------------------

create table notifications (
  id                  uuid primary key default gen_random_uuid(),

  channel             text not null default 'email'
                        check (channel in ('email', 'sms')),
  template            text not null,

  -- Who it is going to, captured at enqueue time. Deliberately denormalised:
  -- the address we actually sent to is a fact about the message, and it must
  -- not change retroactively when a parent edits their profile.
  to_address          text not null,
  to_name             text,

  parent_id           uuid references parents(id) on delete set null,
  child_id            uuid references children(id) on delete set null,
  class_offering_id   uuid references class_offerings(id) on delete set null,
  session_id          uuid references sessions(id) on delete set null,
  enrollment_id       uuid references enrollments(id) on delete set null,
  order_id            uuid references orders(id) on delete set null,

  subject             text,
  -- Everything the template needs, frozen at enqueue time so a message renders
  -- the same way tomorrow as it would have today.
  payload             jsonb not null default '{}'::jsonb,

  status              text not null default 'queued'
                        check (status in ('queued','sending','sent','failed','cancelled')),
  attempts            int  not null default 0,
  max_attempts        int  not null default 5,
  last_error          text,

  -- Reminders are enqueued in advance and become due later.
  scheduled_for       timestamptz not null default now(),
  locked_at           timestamptz,
  sent_at             timestamptz,
  provider_message_id text,

  -- The idempotency of the whole system. One reminder per family per session,
  -- however many times the job runs.
  dedupe_key          text unique,

  created_at          timestamptz not null default now()
);

-- The worker's query: due, not finished, oldest first.
create index notifications_due
  on notifications (scheduled_for)
  where status in ('queued', 'sending');

create index notifications_recent on notifications (created_at desc);
create index notifications_by_session on notifications (session_id);

comment on column notifications.dedupe_key is
  'Unique. Makes enqueueing idempotent: reminder:<session>:<enrollment> can only exist once.';
comment on column notifications.payload is
  'Frozen render context. A message says what it said when it was sent, not what the row looks like now.';

-- ---------------------------------------------------------------------------
-- Claim work safely.
--
-- FOR UPDATE SKIP LOCKED is the same idea as take_seat(): let Postgres decide
-- the winner instead of the application. Two workers running at once each get
-- different rows rather than both sending the same email.
-- ---------------------------------------------------------------------------
create or replace function claim_notifications(p_limit int default 20)
returns setof notifications
language sql as $fn$
  update notifications
     set status = 'sending',
         locked_at = now(),
         attempts = attempts + 1
   where id in (
     select id from notifications
      where status = 'queued'
        and scheduled_for <= now()
      order by scheduled_for
      limit p_limit
      for update skip locked
   )
  returning *;
$fn$;

comment on function claim_notifications(int) is
  'Atomically claims due notifications. SKIP LOCKED means two workers never claim the same row.';

-- A message that has been sending for too long was almost certainly abandoned
-- by a worker that died. Put it back rather than losing it.
create or replace function requeue_stuck_notifications(p_older_than interval default interval '10 minutes')
returns int
language plpgsql as $fn$
declare n int;
begin
  update notifications
     set status = 'queued', locked_at = null
   where status = 'sending'
     and locked_at < now() - p_older_than
     and attempts < max_attempts;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

alter table notifications enable row level security;
create policy staff_all_notifications on notifications
  for all using (is_staff()) with check (is_staff());
grant select, insert, update, delete on notifications to authenticated;
