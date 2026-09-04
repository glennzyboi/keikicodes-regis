# Build status

*The one document to read before touching anything. Current as of 5 September 2026.*

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
pnpm seed --snapshot         # same, without calling their live endpoint
pnpm import:catalogue        # pull their catalogue, live, upserting
pnpm import:catalogue --dry  # run it all in a transaction and keep none of it
pnpm verify:api              # diff our public API against their n8n webhooks
pnpm thunder                 # 50 simultaneous registrations against one class
pnpm notify / reminders / sweep
pnpm test                    # 100 Playwright specs
```

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
| The whole thing | **100 specs, two consecutive green runs, every invariant clean** |

Invariants checked after a full run, all zero: oversold classes, seats that
cannot be accounted for, children with two live places, paid orders never
fulfilled, sessions off their class weekday, external offerings with no link,
sold offerings with no price, consents with no version.

Current catalogue: 19 schools, 10 programs, 28 offerings, 13 of them sold here,
412 scheduled sessions and 58 holidays.

---

## The tests

**100 specs across eight files**, about four minutes. Several pay with a real
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

The suite reseeds in global setup, so it never inherits the previous run, and
every spec that breaks something puts it back.

---

## Bugs found and fixed, worth mentioning on camera

Twelve are in the git history from 4 September. These are the ones the new work
found:

1. **`classes_clash` referred to a column that had been dropped.** Postgres does
   not check a function body against the schema when a column goes, so the error
   arrived at the first parent who tried to register rather than at the
   migration. There is a spec for this now.
2. **The seed hung forever.** It opened its own database client while the
   importer used the shared one, so `end()` closed the wrong pool. Cost a ten
   minute test run to find.
3. **The import cried wolf.** It compared sessions currently running against
   their published count, so the moment the office cancelled an afternoon it
   reported three schedules as broken. An alert that fires on correct behaviour
   is one people learn to ignore.
4. **A parent could claim another family's photograph.** Storage enforced the
   folder on the way in; nothing enforced it on the way back.
5. **An imported link could be `javascript:`.** `new URL` accepts it happily,
   and these strings end up in an href a parent clicks.
6. **The concurrency proof was proving nothing.** It ran against whatever class
   had the most room, which was sometimes emptier than the number of parents.
7. **A client component dragged the Postgres driver into the browser bundle.**
   The same shape as the earlier Stripe formatter incident.
8. **postgres.js returns a `Date` for a `date` column**, so `String(d).slice(0, 10)`
   produced "Tue Aug 25" and took the page down with a RangeError.
9. **The command palette was two pixels tall.** The topbar has a
   `backdrop-filter`, and any element with one becomes the containing block for
   `position: fixed` inside it.

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
