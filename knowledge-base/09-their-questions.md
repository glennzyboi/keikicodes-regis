# Their questions, answered

*The seven things they said they would ask. Written against what is actually
built and verified, not against what was planned. Every claim here has been
demonstrated locally and most can be shown live in the walkthrough.*

*Rewritten 5 September 2026, after reading how their system actually works. The
evidence for that is `11-their-real-system.md`, and it changed several of these
answers.*

---

## 0. The thing to open with

Before writing any of this I read their live site properly. Their
`/find-a-program` page is a Squarespace code block calling two self-hosted n8n
webhooks over Airtable, and `/register` is a Fillout form wired to the same base.

That told me four things the brief did not:

1. **A program is a curriculum, reused.** Thirteen distinct names across
   twenty-eight offerings; "Code Heroes: Virtual Reality" runs at five campuses
   with different grades, times and prices.
2. **Fifteen of your twenty-eight are enrolled on the school's own website.**
   `cost: null` and a `registerUrl` off your domain are exactly the same
   thirteen rows, so it is derivable rather than a judgement call.
3. **A schedule is a first date, a last date, a weekday and a list of holidays.**
   Twenty-five of twenty-eight carry a `noClass` list.
4. **You sell by grade, not by age.**

So the demo runs on **your real catalogue**, imported from your own endpoints:
nineteen campuses, ten programs, twenty-eight offerings. Not six invented
classes. That is the reason the model looks the way it does, and it is the
honest answer to "how would you approach this for real": go and look first.

---

## 1. Walk us through it, including what tools you used

**Three packages, two deployables.**

| Package | What it is |
|---|---|
| `packages/core` | The domain. Schema access, the registration transaction, refunds, notifications, the jobs, the catalogue importer. No React, no Next. |
| `apps/api` | A Hono service. Owns Stripe, the public catalogue endpoints, and the background jobs. |
| `apps/web` | Next.js. The parent site and the office console. |

The split is not decoration. The API service is the only thing holding a Stripe
secret, the only thing verifying webhook signatures, and the only thing running
the jobs. If the frontend is compromised tomorrow, nobody can charge a card with
it.

| Tool | Why |
|---|---|
| **Next.js 16, App Router** | Server components mean a class page renders with live seat counts and no client fetch. Server Actions mean the console mutates without hand written API routes. |
| **Postgres via Supabase** | The hard parts here are all database problems: capacity, idempotency, concurrency, schedules. Supabase adds auth, row level security and storage without running my own identity service. |
| **Hono** | Small, fast, and it is an HTTP service rather than a framework with opinions about rendering. |
| **Stripe Checkout** | Hosted, so card details never touch this system. Products and Prices mirror our catalogue so the money is auditable in your own dashboard. |
| **Resend** | Transactional email. Locally Mailpit ships with the Supabase stack, so the walkthrough shows real messages in a real inbox without mailing a real person. |
| **postgres.js** | Plain SQL. The interesting logic here is SQL and an ORM would hide the part that matters. There was a typed mirror of the schema; nothing read it and it had already drifted, so it is gone. |
| **Playwright** | 101 specs. They are evidence rather than coverage: several pay with a real test card against real Stripe and one issues a real refund. |

**Tools, honestly.** This was built with Claude Code doing the typing. Worth
saying plainly, because it changes what you should look for. The value is not
that files appeared quickly, it is the decisions: taking the seat before
payment, an outbox rather than an inline send, refusing to let a link be a
credential, and reading your live system before designing the schema. Those are
the parts I would defend in review, and the parts I tried to make legible in the
comments.

**Two products, one database.** Parents get a branded, friendly site. Staff get
an operations console with its own design system on its own route group: dark
rail, Inter at 13px, tabular figures. Your playful rounded type is right for
selling a class to a parent and wrong for a screen somebody reads for eight
hours.

---

## 2. The data model, and why

```
schools ──┐
programs ─┼──> class_offerings ──> sessions
terms ────┘         │    │
                    │    └──> offering_blackouts
                    │
   parents ──> children ──> enrollments ──> order_items ──> orders
        │            │                          │
        ├── guardians│                          └──> seat_holds
        ├── consents └── photo in private storage
        └── support_notes

notifications  (outbox, references most of the above)
enrollment_events  (append only audit trail)
staff, webhook_events
```

**The decisions worth defending:**

**A program is a curriculum; an offering is a program at a campus in a term.**
This is the change your own data forced. Ten programs behind twenty-eight
offerings. It also means `class_offerings.title` is the offering's own label
rather than the program's name, because Liholiho runs one curriculum twice on a
Thursday afternoon as "(A+ students only)" and "(non A+ students)". Those are
one course and two classes.

**A term is a row with dates, not a string.** In your Fillout form the current
term is a hardcoded Airtable record id plus the words "Fall 2026" typed into two
separate filter conditions. Rolling to Spring means editing a form in three
places and remembering all three. Here it is a boolean with a partial unique
index, so exactly one term can be current and the database enforces it.

**A schedule is a first date, a last date, a weekday and blackout dates.**
`generate_sessions()` materialises it. The part that took the care is what it
must never do: a session somebody cancelled by hand stays cancelled, a
reschedule is left where it was put, and a date that falls out of range is
deleted only when nothing references it and cancelled with a reason when
something does. Holidays become cancelled sessions rather than gaps, so a
family sees *why* there is no class that week.

**`registration_mode` is on the offering.** Fifteen of yours are enrolled by the
campus. They are listed so families can find them, marked, linked straight to
the school, and the registration transaction refuses them outright. A system
that assumed every class takes money would be wrong about most of your
catalogue.

**`class_offerings` has the capacity, not `sessions`.** A child registers for a
term, not for ten individual Tuesdays. Sessions are materialised rows so one
date can be cancelled without touching anyone's place.

**`seats_taken` is a counter with a check constraint**, not a `count(*)`.
Counting is correct and it races: two transactions both count eleven and both
insert. A single conditional UPDATE cannot.

```sql
constraint seats_within_capacity check (seats_taken <= capacity)
```

**`orders` and `order_items` are separate from `enrollments`.** An order is what
was bought; an enrollment is a place in a room. Different lifetimes: a place can
be cancelled while the order stays as a permanent record of money that moved.

**`seat_holds` is a table, not a column.** A hold has an expiry and belongs to
an order item, and something has to sweep it. A `held_until` column could not
express two families holding two seats.

**`consents` is a table, not a boolean.** Your form records agreement as a
ticked box, so what is stored is "this was ticked at some point, against
whatever the policy said then". That is not a consent record. Ours stores what
was agreed, which version, and when. The first time a family disputes a
cancellation fee, a boolean is worth nothing.

**Grades are smallints with K as 0**, so they sort. A text label like "K-2"
cannot be compared.

**Natural keys everywhere they exist.** A child is
`(parent_id, lower(first_name), lower(last_name), date_of_birth)`. An offering
is `(school_id, term_id, lower(title))`. An order is
`(parent_id, idempotency_key)`. Unique indexes, so "have we seen this already"
is answered by Postgres rather than by code that has to remember to ask.

**`enrollment_events` is append only.** Every decision writes one. It is why
"who approved this refund" has an answer.

**Money is integer cents. Times are `timestamptz`, rendered in the school's
timezone.** A parent in Honolulu and a grandparent in Manila read the same time.

---

## 3. A parent submits the form. What happens, in what order?

**Phase one, one transaction, before any money moves:**

1. **Lock the parent row.** They are signed in, so identity is settled.
   `select ... for update` serialises two simultaneous submissions from the same
   account, which is what makes step 2 safe.
2. **Check the idempotency key.** If this submission already produced an order,
   return that order and stop.
3. **Load the classes** and check each is published, open, and **ours to sell**.
4. **Check the photograph belongs to this family.** The object key is
   `<parent id>/<file>`; anything else is refused.
5. **Resolve each child**, by id if they are already on file, otherwise by
   natural key.
6. **Check grade eligibility** against the class's range.
7. **Reject a child already holding a live place**, and **reject a clash** with
   anything else they hold, named rather than generic.
8. **Record the family details**: phone, attribution, marketing choice, second
   guardian, and the consent with its version.
9. **Create the order and its items.**
10. **Take a seat per item** via `take_seat()`, and create a 30 minute hold. If
    any seat cannot be taken, throw and roll the whole thing back.

**Phase two:** create a Stripe Checkout Session from the stored
`stripe_price_id` values. Line items are built on the server. Nothing the
browser sent can influence what is charged.

**Phase three:** the webhook. Signature verified, event id inserted into
`webhook_events` as a replay guard, then one transaction turns holds into
enrollments and queues the confirmation.

### How do you know if the parent already exists?

They are signed in, so it is answered before the form is submitted. Identity
comes from the session and never from the request body, so nobody can register
children against another account by editing a payload.

At signup an address that already exists **claims** that record rather than
creating a second one, so a family who registered before accounts is not split
in two. The claim refuses if the record belongs to a different account.

There is deliberately **no fuzzy matching** on name or phone. A false merge
joins two families' records, and with children's data that is an incident, not a
bug. A false split is a support ticket. Take the cheap error.

### What if they register two kids in one submission?

One order, two order items, two seats, one payment. Seats are taken in a loop
inside the same transaction and it is **all or nothing**: if the second child
cannot get a seat, the first child's seat goes back with the rollback.

Worth saying out loud on the Loom: **your form cannot do this.** It is one
student per submission, so a family with two keiki fills the whole thing in
twice, retypes both parents, and pays twice. That is the single most visible
improvement in the build and it cost nothing, because the order model already
worked that way.

### Payment succeeds but record creation fails halfway through

**This is why seats are taken before payment rather than after.** By the time
money moves the seats are already ours and the order already exists. Fulfilment
is not "create everything", it is "flip rows that already exist", which is a much
smaller thing to get wrong.

If fulfilment throws anyway the handler returns **500 on purpose**, so Stripe
retries on its own schedule for up to three days. The event id is the primary
key of `webhook_events`, so a retry arriving after a partial success cannot
double enrol. Swallowing the error is the one way to actually lose a paid
registration.

Meanwhile the order sits in the console under **Paid, not confirmed**, the first
queue on the page, because money has moved and the system has not caught up.

One more guard: if a hold has gone missing by the time fulfilment runs it
reclaims the seat, and if the class has genuinely filled it **enrols anyway and
flags it**. We do not refuse a place to somebody who has paid.

### What if the same submission comes in twice?

The form mints an idempotency key when it opens. A double click, a slow retry,
or a resubmission all arrive with the same key, and `(parent_id,
idempotency_key)` is unique.

There was a real bug here worth mentioning. The database side was always safe,
but both requests then called Stripe with the same idempotency key, and Stripe
rejects concurrent use of an in-progress key, so the second 500'd. Fixed by
serialising the checkout work per order with a row lock.

**Verified:** two concurrent identical submissions produce one order, one seat,
one parent. It is a Playwright spec.

---

## 4. Registration opens at 8am. 50 parents, 12 seats.

The seat is taken by one conditional UPDATE:

```sql
update class_offerings
   set seats_taken = seats_taken + 1
 where id = $1 and seats_taken < capacity;
```

Postgres takes a row lock. The fifty transactions queue on that one row, each
re-evaluates `seats_taken < capacity` against the committed value, and the
thirteenth sees 12 and updates zero rows. There is **no read-then-write**, so
there is no window to lose a race in. The losers are told the class is full
before any of them reach a payment page.

Three layers, deliberately:

1. The conditional UPDATE decides the winner.
2. `check (seats_taken <= capacity)` is the invariant of last resort.
3. A partial unique index stops one child holding two places in the same class.

**Verified, and it is a script you can run** (`pnpm thunder`):

```
  Code Explorers: Virtual Reality at Nu'uanu Elementary
  capacity 16, 4 taken, 12 free
  50 parents about to submit at the same moment

  50 registrations in 1091ms

  accepted            12
  told class is full  38
  anything else       0

  seats_taken         16 / 16
  live holds          12

  PASS  accepted exactly the 12 free seats
  PASS  everyone who missed out was told the class is full
  PASS  no request failed for any other reason
  PASS  seats_taken never exceeded capacity
  PASS  the class is now exactly full
  PASS  one new hold per accepted registration
```

That drives the transaction directly. **The HTTP path is proven separately**, by
a test that races eight real signed in browser contexts through the endpoint.

Worth admitting on camera: this test was silently proving nothing for a while.
It ran against whatever class had the most room, and after another test left a
capacity behind, that class had more free seats than there were parents. Every
request succeeded, every check passed, and the capacity guard was never
exercised. It squeezes the class to twelve seats first now. **A concurrency test
that cannot fail is worse than no concurrency test.**

The same idea appears twice more. The notification worker claims rows with
`FOR UPDATE SKIP LOCKED`, so two workers never send the same email. Transfers
take the seat in the destination before releasing it in the origin.

---

## 5. What I deliberately left out of v1

- **A waitlist.** Not in the brief, so not built. But your own form proves you
  need one: there is a step that fires for a single hardcoded Airtable record id
  containing hand-typed copy about Waikiki being full, a manual waitlist, and
  reaching out to Principal Ryan. That is the strongest argument for building
  one properly, and it is a fortnight, because it needs offer windows, expiry
  and a fairness rule.
- **Automated refund policy.** The system issues refunds through the Stripe API,
  but a human chooses the amount. Your real policy is not published anywhere I
  could find, and inventing one would be inventing a business rule.
- **Instructor accounts and attendance.** Real, and out of scope. Attendance
  changes the model, because it needs a row per child per session.
- **Discounts, sibling pricing, scholarships.** Pricing policy questions, not
  code questions.
- **SMS.** The notifications table has a channel column and the worker refuses
  cleanly for anything with no transport, so Twilio is a file rather than a
  migration. Email covers the cases described.
- **Multiple weekdays on one class.** Your `days` field could hold a list; all
  twenty-eight current offerings are a single day. One weekday, and this note.
- **Writing back to Airtable.** The import reads only. Two systems that both
  believe they own the same record is how a migration of this shape dies, and
  the answer is a direction and a cutover date rather than something clever.
- **Payment plans and invoicing.** Real for a $425 program, and a different
  system.

**One thing that was on this list and is now built:** self-serve class creation.
It was going to be left out as "expensive and rare enough to be worth a
deliberate process". That was wrong, and looking at your Airtable is what
changed my mind. Your office adds a class, changes a price or closes
registration in seconds today. A replacement that cannot do that is not a
replacement, it is a regression with better tests, and it would be abandoned
inside a month. So the catalogue is fully editable, and the interesting part is
what it refuses: a capacity below the seats already taken, a price change with
families already paid, a schedule move without telling the families in it.

---

## 6. What I would need to know about your existing system

Four of these I answered myself by reading your site, which is the point.

**Already answered, and built on:**

- What the catalogue looks like: nineteen campuses, ten programs, twenty-eight
  offerings, and the fifteen that schools enrol themselves.
- How a schedule is expressed: dates, a weekday, and a holiday list. Verified
  against the session counts you publish; **twenty-eight of twenty-eight
  reconcile.**
- Where the data comes from: two n8n webhooks over Airtable. Our public API
  answers in the same shape, so pointing your site here is one line in a
  Squarespace code block.
- What your registration form collects. Ours collects every field of it.

**Still need you:**

1. **Capacity.** The one number your public endpoint does not publish, so every
   imported class landed on a default and the import report says so by name. It
   is also the number the whole seat model turns on.
2. **Your refund policy, written down.** Full, pro rata, a cutoff, a fee? Today
   the office chooses per case, which is honest but does not scale.
3. **The current source of truth for families and enrollments.** The Airtable
   base itself, not the public view of it. The migration and the matching rule
   are the whole first phase, and my "no fuzzy matching" position is only safe
   once I have seen the historical data.
4. **Your existing Stripe account.** Your form charges through a live Stripe
   key. If there is history and customers there, this attaches to it rather than
   creating a parallel one, and the Product mirroring changes.
5. **Who is staff, and what may each of them do?** Today staff is one role. If
   instructors should see their own roster but not payment history, that is a
   permissions model, and it is far cheaper before there is data.
6. **Your obligations around children's data.** Retention, who may see medical
   notes and photographs, what happens when a family leaves. This is the
   question that most changes the schema and the one most likely to be answered
   by a rule you follow but have never written down.
7. **What breaks today?** The most useful answer is usually the thing the office
   does every week and has stopped complaining about. From the outside my guess
   is rolling a term over, because doing it means editing a form in three
   places, but you would know.

---

## Things to actually show, in order

1. The front door, on **their real catalogue**. Pick Wai'alae, then Hanahau'oli,
   which is marked "Enrolled through the school" with no Register button.
2. `pnpm verify:api` against their live endpoints.
3. The class editor: the schedule preview counting as you type, the holiday
   struck through, the capacity refusal.
4. A registration with two children, one payment, and the email in Mailpit.
5. `pnpm thunder`.
6. The import dry run: 28 of 28 reconcile.
