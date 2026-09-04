-- ---------------------------------------------------------------------------
-- Refunds stop being a sticky note.
--
-- Until now approving a cancellation set refund_owed and trusted someone to
-- remember to open Stripe and pay it back by hand. That is the step that gets
-- forgotten, and the family who was forgotten is the one who calls.
--
-- The refund is now issued through the Stripe API at the moment of approval,
-- and what comes back is recorded here: which refund, how much, and what state
-- Stripe says it is in. refund_owed stays true until Stripe confirms, so a
-- refund that fails stays visible instead of disappearing.
-- ---------------------------------------------------------------------------

alter table enrollments
  add column if not exists stripe_refund_id     text unique,
  add column if not exists refund_amount_cents  int check (refund_amount_cents >= 0),
  add column if not exists refund_status        text
        check (refund_status in ('pending','succeeded','failed','canceled')),
  add column if not exists refund_error         text,
  add column if not exists refund_requested_at  timestamptz;

comment on column enrollments.refund_owed is
  'True from approval until Stripe confirms the money is on its way back.';
comment on column enrollments.stripe_refund_id is
  'Stripe refund id. Unique, so a retried approval can never refund twice.';
