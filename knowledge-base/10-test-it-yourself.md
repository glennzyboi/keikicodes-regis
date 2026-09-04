# Test it yourself

*Everything you need to drive the system by hand. Rewritten 5 September 2026.*

---

## Before anything

Docker Desktop must be running. Then, from `KeikiCoders/`:

```bash
# 1. Database, auth, storage and the local mail server
supabase start

# 2. The parent site and the console
pnpm --filter web dev            # http://localhost:3000

# 3. The API service
pnpm --filter api dev            # http://localhost:3001

# 4. Stripe webhooks, in its own terminal
SK=$(grep '^STRIPE_SECRET_KEY=' apps/web/.env.local | cut -d= -f2)
./tools/stripe.exe listen --api-key "$SK" --forward-to localhost:3000/api/stripe/webhook
```

The forwarder prints a signing secret each time it starts. If it differs from
`STRIPE_WEBHOOK_SECRET` in `apps/web/.env.local`, paste the new one in. Without
it, payments are taken and never confirmed.

---

## Where things are

| What | Where |
|---|---|
| Parent site | http://localhost:3000 |
| Office console | http://localhost:3000/admin |
| API service | http://localhost:3001/health |
| Local inbox, every email lands here | http://127.0.0.1:55324 |
| Database browser | http://127.0.0.1:55323 |
| Stripe dashboard, test mode | https://dashboard.stripe.com/test/payments |

## Logins

Recreated by every seed, so these always work.

| Role | Email | Password |
|---|---|---|
| **Office staff** | `ops@keikicoders.test` | `KeikiOps!2026` |
| **Parent** | `parent@keikicoders.test` | `KeikiParent!2026` |

You can also sign up at http://localhost:3000/signup. Email confirmation is off
locally, so you are signed in immediately.

**Test card:** `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
No real money moves, ever.

---

## Things worth trying, in order

### 1. Their own catalogue, on your machine

Open http://localhost:3000. It asks which school, because that is the only thing
a parent arrives knowing, and it is what their own site does.

Fifteen campuses, twenty-eight classes, all imported from their live endpoints.
Pick **Wai'alae Elementary**: four classes, all ours to sell. Then pick
**Hanahau'oli School**: two classes, both marked "Enrolled through the school",
with a link straight to hanahauoli.org and no Register button anywhere.

That split is real. Fifteen of their twenty-eight are enrolled by the campus.

### 2. Register, and watch the whole chain fire

1. On a campus page, click a class card. It opens to the full detail: the run of
   dates, the grades, how many holidays have already been taken out.
2. Set the grade filter to a grade the class does not take. It disappears, and
   the page says how many it hid and offers to show them anyway.
3. Hit **Register**. You are bounced to sign in carrying the destination, so you
   land back on that exact class.
4. Fill it in. Note what it asks for, because this is field for field what their
   Fillout form asks for: grade, a head shot, whether the child is in A+ or W+
   care, the confirmation that the child attends that campus, a second guardian,
   how you heard about them, and a consent with a version on it.
5. **Add another child.** One order, two seats, one payment. Their form cannot
   do this: a family with two keiki fills it in twice and pays twice.
6. Pay with the test card. On Stripe's page you must pick **Card** first; the
   fields do not exist until you do.
7. You land on a page that says it is confirming, not confirmed. It waits for
   the webhook, because the redirect only proves your browser came back.
8. **Check the inbox** at http://127.0.0.1:55324.

Then register a second time as the same parent. It offers the child you already
added rather than asking for everything again.

### 3. Own the catalogue, which is the point

Sign in at http://localhost:3000/admin, then **Catalogue**.

- **Classes** is every offering with its grades, sessions, fill and who takes
  the money.
- Open one. The right hand side lists **every date the schedule produces**,
  holidays struck through. Change the last date and the count moves as you type.
  Add a holiday and it drops by one.
- Try setting the capacity below the number of seats taken. It tells you the
  number before you save, and refuses if you insist.
- Change the day or the time on a class somebody is registered for. It offers to
  email the affected families, and says how many.
- **Copy to another campus** does what their catalogue actually needs: the same
  curriculum at a second school, holidays included, as a draft.

### 4. Import from their Airtable

**Catalogue**, then **Import**. Press **Dry run** first: it does the entire
import inside a transaction and rolls it back, so what it reports is what
happened rather than what a simulation predicted.

It reports how many schedules reconcile against the session counts they publish
on their own website. It should say **28 of 28**.

Then, from the command line, the same thing with more detail:

```bash
pnpm import:catalogue --dry
```

### 5. Prove the API is a drop-in for theirs

```bash
pnpm verify:api
```

Fetches their two live n8n webhooks and ours, matches records on campus plus
title, and compares every field their website renders. **Every record is
present**, and the four fields that differ each differ for a reason the script
spells out: two are formats where their own records disagree with each other,
one is the session count (we publish what will actually run, so a session the
office cancelled shows as one fewer), and one is the pictures.

The pictures are the interesting one. Theirs are signed Airtable URLs that
expire; the ones captured at lunchtime were returning **410 Gone** by the
evening. The import keeps its own copy, so the logos still work next week.

### 6. Prove it cannot oversell

```bash
pnpm thunder
```

Fifty simultaneous registrations against one class. Expect exactly the free
seats accepted, everyone else told the class is full, and zero other failures.

Add `--parents 200` for a heavier run, or `--id <uuid>` for a specific class. Do
not use `--class`: the same title runs at up to five campuses.

It drives the registration transaction directly rather than posting to the API,
because registration needs an account and driving fifty signed in sessions from
a CLI means reimplementing Supabase's cookie format. **The HTTP path is proven
separately**, by a test in `jobs.spec.ts` that races eight real signed in
browser contexts.

### 7. Cancel a class date and watch the families get told

1. **Catalogue**, open a class, find its schedule.
2. Cancel the next session with a note.
3. Run the worker: `pnpm notify`
4. Check http://127.0.0.1:55324.

The message was written to the database inside the same transaction as the
cancellation. If the cancellation had rolled back, nobody would have been told.

### 8. Approve a cancellation and refund it automatically

1. As the parent, **My registrations**, expand one, **Request cancellation**.
2. As staff, **Money**, then **Cancellations**.
3. **Approve and refund.** Full, pro rata on the sessions still to run, or an
   amount you type.
4. The refund goes to Stripe immediately. Check
   https://dashboard.stripe.com/test/payments.

### 9. Prove reminders cannot double send

```bash
pnpm reminders -- --days 14
pnpm reminders -- --days 14
pnpm notify
```

The first run queues them. The second queues nothing and says so.

### 10. Prove the sweeper protects a paid seat

```bash
pnpm sweep -- --dry
pnpm sweep
```

Abandoned checkouts release their seats. A hold belonging to a paid order is
reported as protected and left alone.

### 11. Run the test suite

```bash
cd apps/web
set -a && . ./.env.local && set +a
pnpm test
```

**100 specs across eight files**, about four minutes. Several pay with a real
test card, and one issues a real refund.

---

## Resetting

```bash
pnpm seed              # about five seconds
pnpm seed --snapshot   # without calling their live endpoint
```

Clears families, orders, holds and enrolments, and reimports the catalogue.
Class ids survive, so any link you have open still works.

To clear the inbox, use the delete button in Mailpit.

---

## What is not wired up yet

Being explicit so nothing surprises you on camera.

- **Google sign in.** The code path is written and the button appears when
  `NEXT_PUBLIC_GOOGLE_AUTH=true`, but it needs a Google client id and secret.
- **Resend.** Local mail goes to Mailpit. To send for real, put `RESEND_API_KEY`
  in `.env.local` and set `EMAIL_TRANSPORT=resend`.
- **SMS.** The notifications table has a channel column and the worker refuses
  cleanly for anything with no transport, so Twilio is a file rather than a
  migration. Not built, and deliberately so.
- **Capacity.** Their public endpoint does not publish it, so every imported
  class lands on a default of 16 and the import report says so. It is the one
  number the migration cannot know.
