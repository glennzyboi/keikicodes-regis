-- Remember which email addresses this system invented.
--
-- The prototype is seeded with thirty six believable families, and believable
-- means addresses like malia.kealoha@gmail.com, which may well belong to a real
-- person who has never heard of Keiki Coders. Writing to one of those is the
-- single unrecoverable mistake available in this codebase, so something has to
-- stop it.
--
-- The first attempt was an allowlist: name the addresses that MAY receive mail,
-- redirect everything else to one inbox. That is safe and it is also wrong,
-- because it inverts who the rule is about. A real parent fills in the
-- registration form, and their confirmation goes to somebody else's mailbox.
-- From where they are standing the product is broken, and "it is a demo guard"
-- is not a thing they should have to know.
--
-- The rule is about the seed, so this is where the seed writes down what it
-- made up. Anyone whose address is not in this table typed it in themselves and
-- gets their own mail, which is the behaviour a working prototype has to have.
--
-- Exact rather than heuristic, deliberately. Every cleverer version of this
-- ("redirect anything that looks generated", "only deliver to domains we
-- recognise") is a rule that eventually lets a seeded family through, and the
-- whole point is that that can never happen.
create table if not exists demo_addresses (
  address     text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table demo_addresses is
  'Addresses invented by the seed. Mail to these is redirected, never delivered. '
  'Populated by packages/core/src/demo-families.ts; empty in a real deployment.';

-- Lower cased on the way in by the seed, and compared lower cased, so a
-- difference in capitalisation cannot become a delivery.
create index if not exists demo_addresses_lower on demo_addresses (lower(address));

alter table demo_addresses enable row level security;

-- No policies. Only the owner connection (the worker) reads this, and a family
-- has no business knowing which of their neighbours is fictional.
