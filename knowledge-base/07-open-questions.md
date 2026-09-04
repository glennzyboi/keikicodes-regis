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

## Ask before building it for real

1. **Who owns a student record during the migration**, Airtable or the new app. Dual-write kills
   projects of this shape.
2. **The real Airtable schema**: how students, programs, sessions, attendance, enrollment,
   invoicing and payroll relate today, and which fields operations actually rely on.
3. **Which n8n workflows fire on a registration today**, and what must keep firing on day one.
4. **The Stripe account as it stands**: existing products and prices, plain charges or Connect,
   how refunds are handled now, and exactly what Fillout posts today.
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
