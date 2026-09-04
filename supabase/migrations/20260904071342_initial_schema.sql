-- Keiki Coders parent registration system
-- The schema owns the invariants. Every rule the brief states is enforced here, in the
-- database, not in application code that someone can forget to call.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Staff. The only accounts with a password. Parents never log in.
-- ---------------------------------------------------------------------------
create table staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null,
  email        citext not null unique,
  full_name    text not null,
  created_at   timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from staff where auth_user_id = auth.uid());
$fn$;

-- ---------------------------------------------------------------------------
-- Identity. A parent is created by registering, not by signing up.
-- ---------------------------------------------------------------------------
create table parents (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                    -- set only if they claim the portal
  email        citext not null unique,         -- citext: identity is case-insensitive
  full_name    text not null,
  phone        text,
  created_at   timestamptz not null default now()
);

create table children (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid not null references parents(id) on delete restrict,
  first_name    text not null,
  last_name     text not null,
  date_of_birth date not null,
  notes         text,                          -- allergies, medical, pickup
  created_at    timestamptz not null default now()
);

-- The same child submitted twice by the same parent resolves to one row.
-- Scoped to parent_id so two families with a "Noa Kim" never collide.
create unique index children_natural_key
  on children (parent_id, lower(first_name), lower(last_name), date_of_birth);

-- ---------------------------------------------------------------------------
-- Catalogue. Our database owns the class; Stripe mirrors it.
-- ---------------------------------------------------------------------------
create table schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  timezone   text not null default 'Pacific/Honolulu',
  created_at timestamptz not null default now()
);

create table class_offerings (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references schools(id),
  title                 text not null,
  summary               text,
  term                  text not null,               -- 'Fall 2026'
  weekday               int  not null check (weekday between 0 and 6),
  start_time            time not null,
  end_time              time not null,
  weeks                 int  not null check (weeks > 0),
  first_session_date    date not null,
  capacity              int  not null check (capacity > 0),
  seats_taken           int  not null default 0 check (seats_taken >= 0),
  price_cents           int  not null check (price_cents >= 0),
  currency              text not null default 'usd',
  registration_opens_at timestamptz not null,
  status                text not null default 'published'
                          check (status in ('draft','published','closed')),
  stripe_product_id     text,
  stripe_price_id       text,
  created_at            timestamptz not null default now(),
  -- the invariant of last resort. Nothing can oversell, ever.
  constraint seats_within_capacity check (seats_taken <= capacity),
  constraint ends_after_start check (end_time > start_time)
);

-- Sessions are rows, not a recurrence rule. A holiday cancels one week,
-- and an exception needs somewhere to live.
create table sessions (
  id                uuid primary key default gen_random_uuid(),
  class_offering_id uuid not null references class_offerings(id) on delete cascade,
  seq               int  not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            text not null default 'scheduled'
                      check (status in ('scheduled','cancelled','rescheduled')),
  rescheduled_from  uuid references sessions(id),
  note              text,
  unique (class_offering_id, seq)
);

-- ---------------------------------------------------------------------------
-- Money. An order is the commercial record; an enrollment is the operational one.
-- ---------------------------------------------------------------------------
create table orders (
  id                         uuid primary key default gen_random_uuid(),
  parent_id                  uuid not null references parents(id),
  idempotency_key            text not null,
  status                     text not null default 'pending'
                               check (status in ('pending','paid','failed','expired')),
  amount_cents               int  not null check (amount_cents >= 0),
  currency                   text not null default 'usd',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  fulfilled_at               timestamptz,
  created_at                 timestamptz not null default now()
);

-- A double-clicked form returns the same order instead of creating a second one.
create unique index orders_idempotent on orders (parent_id, idempotency_key);
-- The query the ops view runs: paid, but never turned into places.
create index orders_paid_unfulfilled on orders (created_at)
  where status = 'paid' and fulfilled_at is null;

create table order_items (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references orders(id) on delete cascade,
  class_offering_id      uuid not null references class_offerings(id),
  child_id               uuid not null references children(id),
  unit_price_cents       int  not null check (unit_price_cents >= 0),
  stripe_price_id        text,                        -- exactly what they were sold
  starts_from_session_id uuid references sessions(id),
  unique (order_id, class_offering_id, child_id)
);

-- A seat is taken BEFORE payment. That single decision is what makes
-- "payment succeeded but the write failed" a non-event.
create table seat_holds (
  id                uuid primary key default gen_random_uuid(),
  order_item_id     uuid not null unique references order_items(id) on delete cascade,
  class_offering_id uuid not null references class_offerings(id),
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
create index seat_holds_expiry on seat_holds (expires_at);

create table enrollments (
  id                     uuid primary key default gen_random_uuid(),
  class_offering_id      uuid not null references class_offerings(id),
  child_id               uuid not null references children(id),
  order_item_id          uuid references order_items(id),
  status                 text not null default 'active'
                           check (status in ('active','cancellation_requested','cancelled')),
  starts_from_session_id uuid references sessions(id),
  refund_owed            boolean not null default false,
  refunded_at            timestamptz,
  cancellation_reason    text,
  created_at             timestamptz not null default now(),
  cancelled_at           timestamptz
);

-- One child can never hold two live places in one class, whatever the app does.
create unique index one_live_place_per_child
  on enrollments (class_offering_id, child_id)
  where status in ('active','cancellation_requested');

-- ---------------------------------------------------------------------------
-- Two ledgers.
-- ---------------------------------------------------------------------------
create table webhook_events (
  id           text primary key,               -- Stripe's own event id
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create table enrollment_events (
  id            bigserial primary key,
  enrollment_id uuid references enrollments(id) on delete cascade,
  order_id      uuid references orders(id) on delete cascade,
  event         text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seats. One atomic statement. No read-then-write, so no race.
-- ---------------------------------------------------------------------------
create or replace function take_seat(p_class uuid) returns boolean
language plpgsql as $fn$
declare updated int;
begin
  update class_offerings
     set seats_taken = seats_taken + 1
   where id = p_class
     and seats_taken < capacity;
  get diagnostics updated = row_count;
  return updated = 1;
end;
$fn$;

create or replace function release_seat(p_class uuid) returns void
language sql as $fn$
  update class_offerings
     set seats_taken = greatest(seats_taken - 1, 0)
   where id = p_class;
$fn$;

-- Sweeper: an abandoned checkout returns its seat to the pool.
create or replace function release_expired_holds() returns int
language plpgsql as $fn$
declare released int;
begin
  with expired as (
    delete from seat_holds
     where expires_at < now()
    returning class_offering_id
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

-- ---------------------------------------------------------------------------
-- Row level security. Default deny everywhere. The browser holds the anon key
-- and can read nothing beyond the public catalogue; every write goes through a
-- server route running as the service role.
-- ---------------------------------------------------------------------------
alter table staff             enable row level security;
alter table parents           enable row level security;
alter table children          enable row level security;
alter table schools           enable row level security;
alter table class_offerings   enable row level security;
alter table sessions          enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table seat_holds        enable row level security;
alter table enrollments       enable row level security;
alter table webhook_events    enable row level security;
alter table enrollment_events enable row level security;

-- The catalogue is the only public thing, and only when published.
create policy catalogue_is_public on schools for select using (true);
create policy published_classes_are_public on class_offerings for select
  using (status = 'published');
create policy sessions_follow_their_class on sessions for select using (
  exists (select 1 from class_offerings c
           where c.id = sessions.class_offering_id and c.status = 'published')
);

-- A parent who has claimed the portal sees their own records and nothing else.
create policy parent_reads_self on parents for select
  using (auth_user_id = auth.uid() or is_staff());
create policy parent_reads_own_children on children for select
  using (is_staff() or parent_id = (select id from parents where auth_user_id = auth.uid()));
create policy parent_reads_own_orders on orders for select
  using (is_staff() or parent_id = (select id from parents where auth_user_id = auth.uid()));
create policy parent_reads_own_items on order_items for select using (
  is_staff() or exists (
    select 1 from orders o join parents p on p.id = o.parent_id
     where o.id = order_items.order_id and p.auth_user_id = auth.uid())
);
create policy parent_reads_own_enrollments on enrollments for select using (
  is_staff() or exists (
    select 1 from children ch join parents p on p.id = ch.parent_id
     where ch.id = enrollments.child_id and p.auth_user_id = auth.uid())
);

-- Staff see and change everything.
create policy staff_all_parents     on parents           for all using (is_staff()) with check (is_staff());
create policy staff_all_children    on children          for all using (is_staff()) with check (is_staff());
create policy staff_all_schools     on schools           for all using (is_staff()) with check (is_staff());
create policy staff_all_classes     on class_offerings   for all using (is_staff()) with check (is_staff());
create policy staff_all_sessions    on sessions          for all using (is_staff()) with check (is_staff());
create policy staff_all_orders      on orders            for all using (is_staff()) with check (is_staff());
create policy staff_all_items       on order_items       for all using (is_staff()) with check (is_staff());
create policy staff_all_holds       on seat_holds        for all using (is_staff()) with check (is_staff());
create policy staff_all_enrollments on enrollments       for all using (is_staff()) with check (is_staff());
create policy staff_all_events      on enrollment_events for all using (is_staff()) with check (is_staff());
create policy staff_reads_webhooks  on webhook_events    for select using (is_staff());
create policy staff_reads_self      on staff             for select using (auth_user_id = auth.uid());
