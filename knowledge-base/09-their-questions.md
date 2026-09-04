# Their questions, answered

*The seven things they said they would ask. Written against what is actually
built and verified, not against what was planned. Every claim here has been
demonstrated locally and most can be shown live in the walkthrough.*

---

## 1. Walk us through it, including what tools you used

**Stack, and why each one.**

| Tool | Why |
|---|---|
| **Next.js 16, App Router** | Server components mean the registration page renders with live seat counts and no client fetch. Server Actions mean the admin mutates data without hand written API routes. One deployable. |
| **Postgres via Supabase** | The hard parts of this problem are all database problems: capacity, idempotency, concurrency. Postgres solves them properly. Supabase adds auth and row level security without running my own identity service. |
| **Stripe Checkout** | Hosted, so card details never touch this system and PCI scope stays where it belongs. Products and Prices mirror our catalogue so the money side is auditable in their own dashboard. |
| **Supabase Auth** | Email and password today, Google as soon as there are client credentials. Sessions, hashing and rotation are not things worth writing again. |
| **Resend** | Transactional email. Locally, Mailpit ships with the Supabase stack, so a walkthrough shows real messages in a real inbox without sending anything to a real person. |
| **postgres.js** | Plain SQL. The interesting logic here is SQL, and hiding it behind an ORM would hide the part that matters. Drizzle is present as a typed mirror for the shape of tables only. |
| **Playwright** | The tests are evidence rather than coverage. They pay with a real test card against real Stripe and assert the database agrees with the screen. |

**Tools, honestly.** This was built with Claude Code doing the typing. That is
worth saying plainly because it changes what you should look for. The value is
not in how fast the files appeared, it is in the decisions: taking the seat
before payment, an outbox rather than an inline send, refusing to let a link be
a credential. Those are the parts I would defend in review, and the parts I have
tried to make legible in the comments.

**Two products, one database.** Parents get a branded, friendly site. Staff get
an operations console with its own design system on its own route group, dark
rail, Inter at 13px, tabular figures. Their playful rounded type is right for
selling a class to a parent and wrong for a screen someone reads for eight
hours.

---

## 2. The data model, and why

```
schools ──< class_offerings ──< sessions
                   │
                   ├──< seat_holds
                   │
parents ──< children ──< enrollments >── order_items >── orders
   │                          │
   └──< support_notes         └──< enrollment_events

notifications  (outbox, references most of the above)
staff
webhook_events
```

**The decisions worth defending:**

**`class_offerings` is the thing with capacity, not `sessions`.** A child
registers for a term, not for ten individual Tuesdays. Capacity, price and the
seat counter live on the offering. Sessions are materialised rows so that one
date can be cancelled or moved without touching anyone's place.

**`seats_taken` is a counter on the row, with a check constraint.** Not a
`count(*)` over enrollments. Counting is correct and it races: two transactions
both count eleven and both insert. A single conditional UPDATE cannot.

```sql
constraint seats_within_capacity check (seats_taken <= capacity)
```

That constraint is the invariant of last resort. If every other layer has a bug,
the database still refuses to oversell.

**`orders` and `order_items` are separate from `enrollments`.** An order is what
was bought and paid for; an enrollment is a place in a room. They have different
lifetimes: a place can be cancelled while the order stays as a permanent record
of money that moved. Collapsing them would mean either deleting payment history
or keeping ghost enrollments.

**`seat_holds` is a table, not a column.** A hold has an expiry and belongs to an
order item, and something has to be able to sweep it. A `held_until` column on
the offering could not express two families holding two seats.

**Natural keys everywhere they exist.** A child is
`(parent_id, lower(first_name), lower(last_name), date_of_birth)`. A class is
`(school_id, lower(title), term)`. An order is
`(parent_id, idempotency_key)`. These are unique indexes, so the "have we seen
this already" question is answered by Postgres rather than by application code
that has to remember to ask.

**`enrollment_events` is an append only audit trail.** Every decision writes one.
It is why "who approved this refund" has an answer.

**Money is integer cents. Times are `timestamptz`, rendered in the school's
timezone.** A parent in Honolulu and a grandparent in Manila must read the same
class time.

---

## 3. A parent submits the form. What happens, in what order?

**Phase one, one transaction, before any money moves:**

1. **Lock the parent row.** They are signed in, so identity is already settled.
   `select ... for update` on their row serialises two simultaneous submissions
   from the same account, which is what makes step 2 safe.
2. **Check the idempotency key.** If this exact submission already produced an
   order, return that order and stop.
3. **Load the classes** and check each is published and open.
4. **Resolve each child** by natural key, upserting.
5. **Reject a child already holding a live place** in that class, with a readable
   message rather than a constraint violation.
6. **Create the order and its items.**
7. **Take a seat per item** via `take_seat()`, and create a 30 minute hold.
   If any seat cannot be taken, throw and roll the whole thing back.

**Phase two:** create a Stripe Checkout Session from the stored `stripe_price_id`
values. Line items are built on the server. Nothing the browser sent can
influence what is charged.

**Phase three:** the webhook. Signature verified, event id inserted into
`webhook_events` as a replay guard, then one transaction turns holds into
enrollments and queues the confirmation email.

### How do you know if the parent already exists?

They are signed in, so the question is answered before the form is submitted.
Identity comes from the session and never from the request body, so nobody can
register children against another account by editing a payload.

At signup, an address that already exists **claims** that record rather than
creating a second one, so a family that registered before accounts existed is
not split in two. The claim refuses if the record already belongs to a different
account.

There is deliberately **no fuzzy matching** on name or phone. A false merge joins
two families' records, and with children's data that is an incident, not a bug.
A false split is a support ticket. Take the cheap error.

### What if they register two kids in one submission?

One order, two order items, two seats, one payment. Seats are taken in a loop
inside the same transaction and it is **all or nothing**: if the second child
cannot get a seat, the first child's seat is released by the rollback. Enrolling
one and charging for one is a refund conversation and a confused parent on the
first day of term.

### Payment succeeds but record creation fails halfway through

**This is why seats are taken before payment rather than after.** By the time
money moves, the seats are already ours and the order already exists. Fulfilment
is not "create everything", it is "flip rows that already exist", which is a much
smaller thing to get wrong.

If fulfilment throws anyway, the handler returns **500 on purpose** so Stripe
retries on its own schedule for up to three days. The event id is the primary key
of `webhook_events`, so a retry that arrives after a partial success cannot double
enrol. Swallowing the error is the one way to actually lose a paid registration.

Meanwhile the order sits in the admin under **Paid, not confirmed**, which is the
first queue on the page, because money has moved and the system has not caught up.

One more guard: if a hold has gone missing by the time fulfilment runs, it
reclaims the seat, and if the class has genuinely filled, it **enrols anyway and
flags it**. We do not refuse a place to someone who has paid.

### What if the same submission comes in twice?

The form mints an idempotency key when it opens. A double click, a slow network
retry, or the browser resubmitting all arrive with the same key, and
`(parent_id, idempotency_key)` is unique.

There was a real bug here that is worth mentioning. The database side was always
safe, but both requests then called Stripe with the same idempotency key, and
Stripe rejects concurrent use of an in-progress key, so the second one 500'd.
Fixed by serialising the checkout work per order with a row lock.

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

Postgres takes a row lock. The 50 transactions queue on that one row, each
re-evaluates `seats_taken < capacity` against the committed value, and the
thirteenth sees 12 and updates zero rows. There is **no read-then-write**, so
there is no window to lose a race in. The losers are told the class is full
before any of them reach a payment page.

Three layers, deliberately:

1. The conditional UPDATE decides the winner.
2. `check (seats_taken <= capacity)` is the invariant of last resort.
3. A partial unique index stops one child holding two places in the same class.

**Verified, and it is a script you can run:**

```
  Scratch Adventures
  capacity 12, 2 taken, 10 free
  50 parents about to submit at the same moment

  50 requests in 1692ms

  accepted            10
  told class is full  40
  anything else       0

  seats_taken         12 / 12
  live holds          10
```

The same idea appears twice more. The notification worker claims rows with
`FOR UPDATE SKIP LOCKED`, so two workers never send the same email. Transfers
take the seat in the destination before releasing it in the origin.

---

## 5. What I deliberately left out of v1

- **A waitlist.** Not in the brief. It is one sentence to say and a fortnight to
  do properly, because it needs offer windows, expiry and a fairness rule.
- **Automated refund policy.** The system issues refunds through the Stripe API,
  but a human chooses the amount. Their real policy is not published anywhere I
  could find, and inventing one would be inventing a business rule.
- **Instructor accounts and attendance.** Real and out of scope. Attendance in
  particular changes the data model, because it needs a row per child per session.
- **Discounts, sibling pricing, scholarships.** Every one of these is a pricing
  policy question, not a code question, and guessing produces the wrong thing.
- **SMS.** The notifications table has a channel column and the worker refuses
  cleanly for anything it has no transport for, so adding Twilio is a file, not a
  migration. Not built because email covers the cases described.
- **Self serve class creation.** Staff can cancel, move and transfer. Creating a
  new term is a seeded operation, because a wrong class definition is expensive
  and rare enough to be worth a deliberate process.
- **Payment plans and invoicing.** Real for a $420 program, and a different
  system.

---

## 6. What I would need to know about your existing system

**The ones that change the design:**

1. **What is the current source of truth for families and enrollments?** If there
   is an existing database or a spreadsheet, the migration and the matching rule
   are the whole first phase. My "no fuzzy matching" position is only safe if I
   know what the historical data looks like.
2. **Your refund policy, written down.** Full, pro rata, a cutoff date, a fee?
   Right now the office chooses per case, which is honest but does not scale.
3. **Do you already take payment somewhere?** If there is a live Stripe account
   with customers and history, this needs to attach to it rather than create a
   parallel one, and the Product and Price mirroring changes.
4. **How do schools give you rosters and calendars?** If Iolani sends a
   spreadsheet in July, that is an import, and holidays come from their calendar
   rather than being typed in.
5. **Who is staff, and what may each of them do?** Right now staff is one role.
   If instructors should see their own roster but not payment history, that is a
   permissions model, and it is much cheaper to build before there is data.
6. **What are your obligations around children's data?** Retention, who may see
   medical notes, what happens when a family leaves. This is the question that
   most changes the schema, and the one most likely to be answered by a rule you
   already follow but have never written down.
7. **Where does this need to live?** Vercel plus Supabase is a twenty minute
   deploy. If it has to sit inside an existing site or a specific host, that is
   worth knowing before rather than after.
8. **What breaks today?** The most useful answer is usually the thing the office
   does every week that they have stopped complaining about.
