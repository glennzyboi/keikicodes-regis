-- ---------------------------------------------------------------------------
-- The sweeper must never take a seat back from a parent who paid.
--
-- The original version deleted every expired hold and decremented the counter,
-- with no regard for the state of the order behind it. That is a real way to
-- lose a paid registration:
--
--   1. Parent registers. Seat held.
--   2. Parent pays at the very edge of the hold window.
--   3. The sweeper runs before Stripe's webhook lands, deletes the hold, and
--      gives the seat back to the pool.
--   4. The webhook arrives, enrols the child, and deletes a hold that is
--      already gone. The counter now understates reality, and the class can be
--      oversold by exactly that many places.
--
-- Aligning the hold with the Checkout session lifetime makes the window small.
-- This makes it impossible: a hold is only ever released while its order is
-- still unpaid.
-- ---------------------------------------------------------------------------

create or replace function release_expired_holds() returns int
language plpgsql as $fn$
declare released int;
begin
  with expired as (
    delete from seat_holds h
     using order_items oi, orders o
     where h.order_item_id = oi.id
       and oi.order_id = o.id
       and h.expires_at < now()
       and o.status in ('pending', 'expired', 'failed')
    returning h.class_offering_id
  ), counted as (
    select class_offering_id, count(*)::int as n from expired group by 1
  ), bumped as (
    update class_offerings c
       set seats_taken = greatest(c.seats_taken - k.n, 0)
      from counted k
     where c.id = k.class_offering_id
    returning k.n as n
  )
  select coalesce(sum(n), 0)::int into released from bumped;
  return released;
end;
$fn$;

comment on function release_expired_holds() is
  'Returns seats from abandoned checkouts. Never touches a hold whose order is paid.';
