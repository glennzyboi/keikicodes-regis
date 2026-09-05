# Build status

*The one document to read before touching anything. Current as of 5 September 2026,
late.*

---

## THE GOAL

A parent registration system for Keiki Coders, built as a paid trial task that
decides whether Glenn gets the job. USD 25 via Wise. It replaces the interview
they cancelled on 4 September.

**Deadline 9 September, target 8 September.**

Graded on "structure and the decisions behind it", in their own words, not on
features. Five of their seven questions are about failure and concurrency. The
brief is `04-the-brief.md`; read it rather than a paraphrase.
`09-their-questions.md` answers all seven.

---

## What changed in the second pass on 5 September

The first pass made the demo model their real business. This one made the two
things they will actually press work properly, and it started by finding that
one of them did not work at all.

**"Move next class" had been broken since the catalogue migration.** That
migration made `sessions.session_date` NOT NULL; the reschedule insert never set
it, so every attempt to move a class threw. It shipped because the only session
test in the suite clicked *Cancel* next class, and nothing had ever moved one.
That is the single most useful thing to say on camera about testing.

**The schedule is now an editor, not two buttons.** Cancel or move *any* date,
several at once, shift a whole run when a term slips, add a make up class, and
put back something cancelled by mistake. Every change records a reason from a
fixed list and the person who made it, and emailing the families is a tick box
that defaults to on. Details below.

**A parent now says why they are cancelling.** The old code wrote the literal
string `'requested by parent'`, which records nothing.

**The parent site has four tabs instead of one.** Home, Programs, Register,
Dashboard. Browsing and registering were behind the same word, and "My
registrations" described a list of receipts rather than the calendar people
actually open it for.

---

## What changed on 5 September, and why it matters

The demo used to model a business that does not exist: six invented classes at
three campuses. Reading their live site changed the schema, the parent side and
the console. The evidence is in **`11-their-real-system.md`**, and it is the
most useful document here after the brief.

The short version: a program is a curriculum reused across campuses, over half
their catalogue is registered on the school's own website and must never be sold
here, a schedule is a first date, a last date and a list of holidays, and they
use grades rather than ages. All four were wrong before.

---

## Where everything lives

```
KeikiCoders/
  packages/core/       the domain. No React, no Next.
    src/               db, registration, refunds, notify, jobs, policies,
                       identity, catalogue import and parsing
    scripts/           seed, import-catalogue, jobs, thunder, verify-api-parity
  apps/api/            Hono service: public catalogue, Stripe webhook, cron jobs
  apps/web/            Next.js: parent site and office console
  supabase/migrations/ 14 migrations. The schema is here and nowhere else.
  fixtures/            a captured snapshot of their live catalogue
  knowledge-base/      this
  render.yaml          two services, three cron jobs
```

There is deliberately **no ORM and no TypeScript copy of the schema**. There was
one, nothing read it, and it had already drifted.

---

## How to run it

From `KeikiCoders/`. Docker Desktop must be running.

```bash
supabase start                   # database, auth, storage, local mail
pnpm --filter web dev            # http://localhost:3000
pnpm --filter api dev            # http://localhost:3001

# Stripe webhooks, in its own terminal
SK=$(grep '^STRIPE_SECRET_KEY=' apps/web/.env.local | cut -d= -f2)
./tools/stripe.exe listen --api-key "$SK" --forward-to localhost:3000/api/stripe/webhook
```

The forwarder prints a signing secret each time it starts. If it differs from
`STRIPE_WEBHOOK_SECRET` in `apps/web/.env.local`, paste the new one in. Without
it, payments are taken and never confirmed.

**Ports are non-standard** (Supabase on 55320 to 55329) because two other
Supabase stacks live on this machine.

| What | Where |
|---|---|
| Parent site | http://localhost:3000 |
| Office console | http://localhost:3000/admin |
| API service | http://localhost:3001 |
| Local inbox | http://127.0.0.1:55324 |
| Database browser | http://127.0.0.1:55323 |

**Logins**, recreated by every seed so they always work:

| Role | Email | Password |
|---|---|---|
| Office staff | `ops@keikicoders.test` | `KeikiOps!2026` |
| Parent | `parent@keikicoders.test` | `KeikiParent!2026` |

Test card `4242 4242 4242 4242`, any future expiry, any CVC. Stripe test mode
throughout; no real money moves.

---

## Commands

```bash
pnpm seed                    # reset to a known state, about five seconds
pnpm check:schedule          # 62 checks on the schedule engine, mostly rolled back
pnpm seed --snapshot         # same, without calling their live endpoint
pnpm import:catalogue        # pull their catalogue, live, upserting
pnpm import:catalogue --dry  # run it all in a transaction and keep none of it
pnpm verify:api              # diff our public API against their n8n webhooks
pnpm thunder                 # 50 simultaneous registrations against one class
pnpm notify / reminders / sweep
pnpm test                    # 101 Playwright specs
```

---

## The schedule engine

`packages/core/src/schedule.ts`, driven from `apps/web/src/app/admin/schedule-actions.ts`.

| Operation | What it does |
|---|---|
| `cancelSessions` | Any number of dates at once, one email covering all of them |
| `restoreSession` | Puts a cancelled date back, and drops the blackout if it came from one |
| `moveSession` | New date, optionally a new time. Original kept, marked moved, pointing at the replacement |
| `shiftSessions` | A whole run by N days, latest first so it never collides with itself |
| `addSession` | A make up class, on any weekday, that a regeneration will not delete |

Five things it gets right that are worth naming:

1. **A reason is a code, not a sentence.** Free text alone gives you "N/A",
   "sick" and "Sick teacher" in three rows and answers no question anybody has.
   The note is kept as well, because no fixed list survives a school year.
2. **Every change is in `session_events`**, append only, with the staff member
   who made it. "Who moved week nine" has an answer in February.
3. **Notifications are written in the same transaction as the change.** A
   rolled back cancellation cannot leave forty families told about it.
4. **`for update` on the dates being edited.** Without it, two staff cancelling
   the same date in the same second both succeeded and the audit trail doubled.
   Same lesson as `take_seat`: decide the winner with a row lock, not with an
   `if`.
5. **A savepoint around the insert.** The row lock cannot help when two people
   move two *different* dates onto the same new one; only the unique index
   catches that, and in Postgres a constraint violation poisons the whole
   transaction. The savepoint turns a 500 into the same sentence the pre-flight
   check would have produced.

A hand shift records the dates it vacates as blackouts. Without that, the next
regeneration puts a fresh class back on the empty date and the term silently
grows by one.

---

## The data model

```
schools ──┐
programs ─┼──> class_offerings ──> sessions
terms ────┘         │    │
                    │    └──> offering_blackouts
                    │
   parents ──> children ──> enrollments ──> order_items ──> orders
        │            │                          │
        ├── guardians│                          └──> seat_holds
        └── consents └── photo in private storage
```

**A program is a curriculum**, reused across campuses and terms. 10 programs
behind 28 offerings. `class_offerings.title` is the offering's own label, which
is not always the program name: Liholiho runs one curriculum twice on a Thursday
as "(A+ students only)" and "(non A+ students)".

**A schedule is a first date, a last date, a weekday and blackout dates.**
`generate_sessions()` materialises it, and the part that took care is what it
must never do: a session a human cancelled stays cancelled, a reschedule is left
alone, and a date that falls out of range is deleted only when nothing
references it and cancelled with a reason when something does. Blackouts appear
as cancelled sessions rather than gaps, so a family sees why there is no class
that week.

**Rules the database enforces**, not the application:

- `seats_taken <= capacity`. Nothing can oversell, ever.
- one live place per child per class, as a partial unique index
- `first_session_date` must fall on the class weekday
- an external offering must have somewhere to send families
- an offering we sell must have a price
- exactly one term can be current
- `sessions` unique on `(class_offering_id, session_date)`, so regeneration is
  keyed on a date rather than a position

**Seats are taken before payment.** That single decision turns "payment
succeeded but the write failed" from a data loss incident into a retryable
no-op. `take_seat()` is one conditional UPDATE, so the winner is decided by row
locking rather than by anything the application does.

---

## What is built

**Parent side.** School first, because that is the only thing a parent arrives
knowing, and it is the one part of their existing design that is exactly right.
Grade filters the list and says how many it hid. Classes a campus enrols itself
are listed, marked, and linked to the school, with no way to pay here.
Registration collects everything their Fillout form collects, and stops asking
for anything already on file: two children go on one order and one payment,
which their form cannot do at all.

**Office console.** Overview, Money (payments, cancellations and refunds in one
place), Families, Students, Catalogue, Rosters, Schedule, Seat holds, Outbox,
and a search box that actually searches.

**The catalogue is editable**, which was the whole gap. Campuses, programs,
terms and classes. The class editor previews the schedule as you type, and
refuses or warns on the things a spreadsheet lets you do silently: capacity
below the seats already taken, a price change with families already paid, a
schedule move without telling the families in it.

**The API service** answers the public catalogue in exactly the shape their n8n
webhooks answer, so migrating their site is a one line change to a variable in a
Squarespace code block.

---

## Verified, with numbers

| Claim | Evidence |
|---|---|
| The schedule model matches their real data | 28 of 28 offerings reconcile against their own published session counts |
| Our public API is a drop-in for theirs | every record present; four fields differ and each one is a decision, named by `pnpm verify:api` |
| Nothing oversells | 50 simultaneous registrations against 12 seats: exactly 12 accepted |
| The HTTP path too | 8 real signed in browser contexts racing 3 seats |
| A paid seat is never swept | proven directly in SQL, and in the suite |
| Reminders cannot double send | three runs, one email |
| A child's photo is private | owning family 200, staff 200, another family denied, anonymous denied |
| A move survives a schedule regeneration | the replacement is `origin = 'manual'`, asserted after calling `generate_sessions` again |
| Two staff cannot both cancel the same date | two real committed transactions race; one wins, one audit row |
| Two moves onto one date do not crash | savepoint turns the unique violation into a sentence |
| A malformed class URL is a real 404 | checked in `src/proxy.ts` before the response starts streaming |
| The whole thing | **128 specs, two consecutive green runs, no skips, every invariant clean** |

Invariants checked after a full run, all zero: oversold classes, seats that
cannot be accounted for, children with two live places, paid orders never
fulfilled, sessions off their class weekday, external offerings with no link,
sold offerings with no price, consents with no version.

Current catalogue: 19 schools, 10 programs, 28 offerings, 13 of them sold here,
412 scheduled sessions and 58 holidays.

---

## The tests

**128 specs across ten files**, about six minutes. Several pay with a real
test card against real Stripe, and one issues a real refund.

| File | What it is for |
|---|---|
| `auth.spec.ts` | Signed out, wrong role, one family reaching for another's data |
| `abuse.spec.ts` | Malformed ids, injection, open redirects, photo theft, hostile URLs |
| `admin.spec.ts` | Every console tab, checked against the database, plus the search |
| `catalogue.spec.ts` | Schedule generation, catalogue CRUD, guardrails, conflicts, consent |
| `api.spec.ts` | The public endpoints and the import, shape by shape |
| `parent.spec.ts` | Signup through cancellation, and the full money lifecycle |
| `jobs.spec.ts` | The background jobs, plus eight browser contexts racing |
| `registration.spec.ts` | The path a family actually walks, end to end |
| `schedule.spec.ts` | The schedule editor: cancel, restore, move, shift, add, and every refusal |
| `site.spec.ts` | Navigation, the school combobox, the cards, paging, and the 404s |

There are **no skipped tests**. Three of them used to skip on a fresh database,
because they needed more students or an existing enrollment than the seed
provides, so they now create their own data and clean it up. A test that skips
on a clean machine is worse than no test: the row in the report looks like
coverage.

The suite reseeds in global setup, so it never inherits the previous run, and
every spec that breaks something puts it back.

---

## Bugs found and fixed, worth mentioning on camera

Twelve are in the git history from 4 September, nine more from the first pass on
the 5th. These are from the second pass, and every one was found by running the
thing rather than by reading it.

1. **"Move next class" had never worked.** The catalogue migration made
   `sessions.session_date` NOT NULL; the reschedule insert never set it, so
   every move threw. It shipped because the only session test clicked *Cancel*
   next class. This is the best single argument for testing the boring path.
2. **A moved session undid itself.** The replacement row was `origin =
   'generated'`, so the next schedule regeneration deleted it. The move
   appeared to work and then quietly reverted.
3. **Two staff cancelling the same date both won.** Read the status, decide,
   then write: the same read-then-write shape `take_seat` exists to avoid. Fixed
   with `select ... for update`, which is what `schedule-check.ts` proves.
4. **Two moves onto the same date crashed the transaction.** Row locks cannot
   help when two people lock different rows. Only the unique index catches it,
   and a constraint violation poisons a Postgres transaction, so it needed a
   savepoint to become an answer instead of a 500.
5. **A bulk shift grew the term.** Shifting dates in place leaves a hole, and the
   next regeneration puts a fresh class on it. Vacated dates are now recorded as
   closures.
6. **`optionalText` was not optional.** It required the key to be present in
   FormData, so any form that did not render an optional field failed with
   "expected string, received undefined". Found by clicking a button with no
   note box on it. `optionalUrl` had the same hole.
7. **The cancel endpoint validated before checking the session**, so an
   anonymous caller got a 400 describing the schema instead of a 401. Caught by
   an existing auth test.
8. **The school combobox never opened on click.** With `autoFocus` the field
   already holds focus, so clicking it fires no focus event. The register page's
   picker looked broken to anybody who clicked before typing.
9. **A `loading.tsx` turned a 404 into a 200.** Placed at `register/`, it wrapped
   `register/[id]` in a Suspense boundary; once a response streams its status is
   already sent, so `notFound()` degraded to a soft 404. The landing skeletons
   now live in route groups so they cannot cover an id route.
10. **The seed left the audit trail behind.** Session ids survive a reseed
    because `generate_sessions` upserts on `(class, date)`, so yesterday's
    `session_events` attached themselves to today's sessions. A test cancelled
    three dates and found four cancellations.
11. **`--color-sun-soft` was never declared**, so `bg-sun-soft` was silently
    dropped and the special-notes panel on a class card had no background.
12. **`.ops-label` was inline**, so every label sat beside its own field rather
    than above it.
13. **A dead image URL was stored as if it were good.** The Airtable links in
    the committed snapshot expired during this build and every one answered 410.
    A link we have just proved is broken is now stored as null, so the page
    falls back to the initial-letter tile instead of rendering a broken image.

---

## Traps that keep costing time

- **Bash heredocs mangle TypeScript and SQL.** Apostrophes and backslashes get
  eaten. Use the Write tool, or write a Python patch script.
- **`::text::jsonb`**, not `::jsonb`, or a JSON string is stored instead of an
  object and templates render "undefined".
- **ISO strings plus `::timestamptz`** for dates, never a `Date` object next to
  a jsonb cast.
- **The Stripe API version is `2026-08-26.dahlia`.** Do not let a tool bump it.
- **A class title is not unique.** The same curriculum runs at up to five
  campuses. Always select by id.
- **Zero em dashes** in anything Glenn sends.

---

## Still to do

1. **Record the Loom.** The old script in `../keiki-build-plan.html` section 08
   predates all of this. `09-their-questions.md` is the source.
2. **The reply to Peter has still not gone out.** Drafted in section 10 of the
   same file, and now needs rewording given the delay.
3. **Glenn's Wise email or phone**, which they need to send the $25.
4. Google OAuth needs a client id and secret to be demonstrable.
5. Resend needs an API key to send for real; local mail goes to Mailpit.
6. A Content-Security-Policy, deliberately not faked.
