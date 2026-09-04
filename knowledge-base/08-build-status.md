# Build status and knowledge transfer

*Rewritten 4 September 2026 after the adversarial test pass. This is the file to
read first when picking the work back up. Update it as things change.*

---

## THE GOAL

Build a **parent registration system** demo for Keiki Coders, record a Loom
walkthrough, and send it. It is a **paid trial task**, USD 25 via Wise, and it
replaces the interview they cancelled on 4 September.

**Deadline: 9 September 2026. Target sending on 8 September.**

The full brief is in `04-the-brief.md`, verbatim. Read that, never a paraphrase.
The answers to all seven of their questions are in `09-their-questions.md`.
`10-test-it-yourself.md` has the logins and a nine step walkthrough.

They judge **structure and the decisions behind it**, in their own words. Five of
their seven questions are about failure and concurrency, not features.

---

## WHERE EVERYTHING LIVES

```
Desktop/Upwork-Profile-Update/KeikiCoders/
  knowledge-base/        client knowledge, the brief, brand tokens, these notes
  registration/          the Next.js app
  supabase/              config.toml and nine migrations
  tools/stripe.exe       Stripe CLI 1.50.10, gitignored
```

Nothing lives outside that folder. Git is local only, no remote, 16 commits.

---

## RUNNING IT

Docker Desktop first. Then three terminals:

```bash
# 1. Database, auth and the local mail server
cd KeikiCoders && supabase start

# 2. The app
cd registration && ./node_modules/.bin/next dev --port 3000

# 3. Stripe webhooks, from KeikiCoders/
SK=$(grep '^STRIPE_SECRET_KEY=' registration/.env.local | cut -d= -f2)
./tools/stripe.exe listen --api-key "$SK" --forward-to localhost:3000/api/stripe/webhook
```

The forwarder prints a signing secret. If it differs from
`STRIPE_WEBHOOK_SECRET` in `registration/.env.local`, paste the new one in, or
payments will be taken and never confirmed.

| Service | URL |
|---|---|
| Parent site | http://localhost:3000 |
| Office console | http://localhost:3000/admin |
| Mailpit, every email lands here | http://127.0.0.1:55324 |
| Supabase Studio | http://127.0.0.1:55323 |
| API | http://127.0.0.1:55321 |
| Database | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |

**Ports are deliberately non-standard.** Glenn has two other Supabase stacks
(`checksocial`, `restorative-spaces`) holding 54321 to 54324.

**pnpm refuses to run scripts** in this project because of ignored esbuild build
scripts. **Call the binaries directly:**

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/<name>.ts
./node_modules/.bin/playwright test
./node_modules/.bin/next dev
```

### Logins, both created by the seed

| Role | Email | Password |
|---|---|---|
| Staff | `ops@keikicoders.test` | `KeikiOps!2026` |
| Parent | `parent@keikicoders.test` | `KeikiParent!2026` |

Re-running the seed resets both passwords, so these always work. Test card is
`4242 4242 4242 4242`, any future expiry, any CVC.

### The five scripts

```bash
scripts/seed.ts        catalogue, sessions, Stripe prices, both logins
scripts/notify.ts      deliver queued mail    (--watch, --dry)
scripts/reminders.ts   queue day-of reminders (--days N, --dry)
scripts/sweep-holds.ts release abandoned seats (--watch, --dry)
scripts/thunder.ts     the concurrency proof  (--parents N, --class "Title")
```

All are safe to run repeatedly. Seeding clears families, orders, holds and
enrollments, and **leaves the catalogue alone**, so class ids survive and open
links keep working.

---

## WHAT THE SYSTEM DOES

### Parents

- **Real accounts.** Supabase Auth, email and password. Google is wired but
  needs client credentials. **No magic links:** the first cut used an HMAC signed
  link, and a link that IS the credential is the wrong trade for a system holding
  children's dates of birth and medical notes.
- Browse a catalogue of expandable class cards, each with its own colour and
  mark, showing live seat counts.
- Register one or several children in one submission, one payment.
- `/portal` shows every registration as a **month calendar with a filter per
  child**, or as expandable detail cards, and requests a cancellation.

### Office console at `/admin`

Its own design system (`admin/ops.css`, imported only by the admin layout), dark
rail, grouped by the job someone came to do:

| Group | Pages |
|---|---|
| **Today** | Overview (chart, activity feed, capacity table), Money |
| **People** | Families, Family detail, Students |
| **Programs** | Classes, Class detail, Schedule calendar, Seat holds |
| **Comms** | Outbox |

- **Money** merges payments, cancellations and refunds into four sub tabs, with
  an expandable ledger row per order.
- **Family detail** is the CX page: keiki with medical notes, registrations,
  payment history with Stripe links, every message sent, and an append only log
  of phone calls.
- **Class detail** carries roster, schedule and that class's payments, plus
  transfer, cancel a date and reschedule a date.

### Automation

- A **notifications outbox**. Messages are written in the same transaction as
  the thing that caused them, and delivered by a worker. Nothing sends inline.
- Triggers: registration confirmed, session cancelled, session rescheduled,
  cancellation approved, day-of class reminder.
- `dedupe_key` makes enqueueing idempotent, so a cron that fires hourly still
  sends one reminder per family per session.
- **Refunds go to Stripe automatically** on approval, keyed on the enrollment id
  so a retry never pays a family twice. Full, pro rata, or a typed amount.
- Resend in production, Mailpit locally, one interface, both plain HTTP.

---

## THE DATA MODEL

```
schools ──< class_offerings ──< sessions
                   │
                   ├──< seat_holds
                   │
parents ──< children ──< enrollments >── order_items >── orders
   │                          │
   └──< support_notes         └──< enrollment_events

notifications   staff   webhook_events
```

Nine migrations, applied in order. `20260904071342_initial_schema.sql` is the
source of truth; `registration/src/lib/schema.ts` is a typed Drizzle mirror for
queries only. **If they disagree, the SQL wins.**

The invariants that matter, all in the database:

- `check (seats_taken <= capacity)` on `class_offerings`
- `take_seat()`, one atomic `update ... where seats_taken < capacity`
- `one_live_place_per_child` partial unique index
- `children_natural_key` unique on `(parent_id, lower(first), lower(last), dob)`
- `orders_idempotent` unique on `(parent_id, idempotency_key)`
- `class_offerings_natural_key` on `(school_id, lower(title), term)`
- `notifications.dedupe_key` unique
- `webhook_events.id` primary key on Stripe's own event id
- `classes_clash()` and `clashing_enrollments()` for schedule conflicts
- RLS on every table, default deny, **and the grants that make it real**

---

## TESTS

**61 specs across five files.** Run them with:

```bash
cd registration
set -a && . ./.env.local && set +a
./node_modules/.bin/playwright test
```

Global setup reseeds first, so a run never inherits the run before it. Global
teardown closes the one shared database client.

| File | Covers |
|---|---|
| `auth.spec.ts` | Every private page and write endpoint refused when signed out. A parent refused at all eight console pages. One family unable to read or cancel another's data. Parent credentials refused at the staff door with the session torn down. Identical messages for a wrong password and a nonexistent address. Staff are not a family. |
| `abuse.spec.ts` | Seven malformed ids, seven malformed payloads, invalid JSON, SQL metacharacters stored verbatim, a script tag proven not to become an element, four open redirect payloads, and the business rules attacked from the API. |
| `admin.spec.ts` | Every tab asserted against the database rather than a 200. Search, expandable rows, session cancellation emailing everyone, transfers, calendar navigation, outbox filters, protected holds. |
| `parent.spec.ts` | Signup through cancellation, the card disclosure, seat counts matching the database, the date field, the portal calendar and child filter, and the full money lifecycle ending in a real Stripe refund. |
| `jobs.spec.ts` | The four background scripts run as real processes, plus eight signed in browser contexts racing the endpoint. |

**Verified, with numbers:**

- **50 parents against 12 seats: exactly 12 accepted, 38 refused, 0 errors,
  counter at 12/12.** Twice, independently.
- Eight real signed in browser contexts racing the HTTP endpoint for 3 seats:
  3 accepted, 5 refused, 0 errors.
- Concurrent double submit: one order, one seat, one parent.
- A partial refund reached Stripe as `re_...`, came back succeeded, freed the seat.
- Running the reminder job three times queues the reminders once.
- The sweeper released an abandoned hold and protected a paid one.
- RLS both ways: staff see every family, anyone else sees none.

**Database invariants after two full runs, all zero:** oversold classes, negative
seats, counter drift, a child twice in a class, duplicate dedupe keys, staff who
are also parents, paid orders never fulfilled.

---

## BUGS FOUND AND FIXED

Kept because they are the interesting part, and because several are worth
mentioning on camera.

1. **Stripe checkout changed shape.** Payment methods are a collapsed accordion,
   so card fields do not exist until Card is chosen, and the row is covered by an
   offscreen overlay. Use
   `getByRole("radio", { name: "Card" }).check({ force: true })`.
2. **A double clicked submit could 500.** Both requests called Stripe with the
   same idempotency key. Fixed with a row lock per order.
3. **The sweeper could take a seat back from a parent who had paid**, and holds
   expired at 15 minutes against a 30 minute payment page.
4. **Row level security was decorative.** Policies existed, grants did not, and
   everything ran as the owner. Granted, and it became load bearing.
5. **Reseeding broke every open link**, because the seed minted new class ids
   each run. Now upserts on a natural key.
6. **A malformed id was a 500**, because Postgres raises on a bad uuid cast.
7. **`formatMoney` lived in `lib/stripe`**, dragging the server-only Stripe
   client into the client bundle.
8. **The date field discarded partial input**, so picking a month blanked it
   before you could pick a year.
9. **`thunder.ts` was silently broken** once registration required an account.
   All 50 requests came back 401, so the concurrency proof was proving nothing
   while still looking like it ran.
10. **Staff visiting `/portal` got a 500**, and before that a phantom `parents`
    row, because both sides share one Supabase session.
11. **The seed used `listUsers()`**, which is paginated. Once enough test
    accounts existed the staff account fell off page one and the seed tried to
    create an account that already existed.
12. **Every spec closed the shared database client in `afterAll`**, so the first
    file to finish tore the pool out from under the rest.

---

## THINGS THAT WILL BITE A FRESH SESSION

- **Heredocs in the Bash tool mangle backslashes.** Writing TypeScript or SQL
  with `cat > file <<'EOF'` fails on apostrophes and escape sequences. **Use the
  Write tool**, or write a Python patch script to the scratchpad and run that.
  This has cost time repeatedly.
- **`tx.json()` does not work** inside a `sql.begin()` transaction in
  postgres.js. Use `${JSON.stringify(x)}::text::jsonb`. A plain `::jsonb` cast
  stores a JSON **string**, not an object, which then renders as `undefined`.
- **Dates go to postgres.js as ISO strings with an explicit cast**,
  `${d.toISOString()}::timestamptz`. Passing a `Date` next to a jsonb cast
  confuses the driver's type inference.
- **The Stripe API version must be `2026-08-26.dahlia`.** Guessing returns 400.
- **`supabase db reset` wipes everything.** Reseed after.
- **The Playwright MCP browser locks to one session.** If it says "Browser is
  already in use", kill the Chrome processes for that profile.
- **Zero em dashes** in anything Glenn sends a client. House rule, absolute.

---

## STILL TO DO

1. **Record the Loom.** The script in `../keiki-build-plan.html` section 08
   predates accounts, notifications, the calendars and the console restructure.
   **It needs a rewrite before recording.** `09-their-questions.md` is current
   and is the better source.
2. **The topbar search in the console is decoration.** The Families and Students
   search is real and tested; that one is not wired. Remove it or wire it before
   recording, because clicking a dead control on camera is worse than never
   showing it.
3. **Google OAuth needs a client id and secret** to be demonstrable. The code
   path is written; the button appears when `NEXT_PUBLIC_GOOGLE_AUTH=true`.
4. **Resend needs an API key** to send for real. Local Mailpit works and is
   arguably the better demo.
5. Optional: a Content-Security-Policy. Deliberately not faked, because doing it
   properly with Next's inline scripts means threading nonces through
   middleware, which is a real task with a test pass.

---

## OPEN QUESTIONS FOR GLENN

1. **His Wise email or phone number**, for the payment line at the end of the
   Loom. Asked twice, still unanswered.
2. Whether to delete the empty `Desktop\KeikiCoders` folder.
3. **The reply to Peter has still not gone out.** Drafted in
   `../keiki-build-plan.html` section 10. It acknowledges the change and commits
   to 8 September. A same day acknowledgement was the recommendation on the 4th;
   it is now late enough that the draft should be reworded before it goes.
