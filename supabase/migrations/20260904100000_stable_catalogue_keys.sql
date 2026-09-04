-- ---------------------------------------------------------------------------
-- Natural keys on the catalogue, so seeding stops inventing new ids.
--
-- The seed truncated class_offerings and inserted fresh rows, which minted a
-- new uuid for every class on every run. Since the Playwright suite reseeds in
-- global setup, running the tests silently invalidated every /register/<id>
-- link anyone had open: the catalogue in a browser tab pointed at classes that
-- no longer existed, and clicking Register returned a 404.
--
-- A class is identified by the campus it runs at, its title and its term. That
-- is a real key, not a surrogate, so it belongs in the schema rather than in a
-- convention the seed script remembers to follow.
-- ---------------------------------------------------------------------------

create unique index if not exists schools_name_key
  on schools (lower(name));

create unique index if not exists class_offerings_natural_key
  on class_offerings (school_id, lower(title), term);

comment on index class_offerings_natural_key is
  'One offering per campus, title and term. Lets the seed upsert instead of recreating, so class ids survive a reseed and open registration links keep working.';
