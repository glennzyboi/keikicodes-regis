# Open questions for Keiki Coders

Two kinds. The first are worth asking now, in the thread. The second are the answers to their own
question, *"what would you need to know about our existing system before building this for real?"*,
and belong in the Loom rather than in a message.

## Ask now

1. ~~**Waitlist or a clean stop?**~~ **Decided: out of scope.** Never mentioned in their brief,
   confirmed by re-reading it. A full class says so and stops. It is a sentence Glenn says in the
   Loom, not code.
2. ~~**Cancellation semantics.**~~ **Built as request then approve**, which is what their brief
   describes. The seat stays held while the office decides, and approving is the only thing that
   releases it. Still worth confirming out loud in the walkthrough.
3. **Confirm the Wise details and the delivery date.** Still outstanding. Glenn has been asked
   twice for the Wise email or phone and has not answered.

## Answered on 5 September by reading their live site

Do not spend time re-investigating these. The full write up is
`11-their-real-system.md`.

- **How the catalogue is exposed**: two public n8n webhooks over Airtable,
  `get-programs` and `get-schools`, read by a Squarespace code block.
- **The shape of a program record**: name, grades, season, site, location, days,
  time, dates, cost, sessions, image, specialNotes, description, registerUrl,
  noClass.
- **Exactly what their Fillout form collects**, field by field, including the
  required head shot and the A+ / W+ care question. Ours collects all of it.
- **That their form charges through a live Stripe key**, minting a one-time
  charge whose amount is pulled from Airtable at checkout time. There are no
  Stripe Products or Prices per class today.
- **That 15 of 28 offerings are enrolled on the school's own website.**
- **How their schedules work**: dates, a weekday, and a holiday list. Verified
  against their own published session counts, 28 of 28.

**The one thing their public data does not expose is capacity**, which is also
the number the whole seat model turns on. It is question one below.

## Ask before building it for real

0. **Capacity, per class.** Not published anywhere public, so every imported
   offering landed on a default and the import report names them. Everything
   about overselling depends on this number being right.

1. **Who owns a student record during the migration**, Airtable or the new app. Dual-write kills
   projects of this shape.
2. **The real Airtable schema**: how students, programs, sessions, attendance, enrollment,
   invoicing and payroll relate today, and which fields operations actually rely on.
3. **Which n8n workflows fire on a registration today**, and what must keep firing on day one.
4. **The Stripe account as it stands**: it is live and it is charging today, so
   this needs to attach to that history rather than create a parallel account.
   Partly answered: the form mints a one-time charge with a dynamic amount and
   no Product per class, so introducing Products is a change to how their money
   is recorded, not just an implementation detail.
5. **Every user type and what each may see.** Parents, teachers, school administrators, internal
   ops. RLS policies are written from that answer.
6. **The enrollment calendar and the freeze window.** When does registration open next, and when
   should nothing ship.
7. **Peak concurrency.** 1,500 children and 20 schools gives the size; what matters is how many
   parents hit one popular class in the first minute.
8. **What breaks most often now, and who finds out first**, engineering or operations.
9. **Children's data rules.** Retention, who may read medical and allergy notes, and any school
   district requirements.
10. **Softr at cutover.** Retired, or run alongside for a season.
