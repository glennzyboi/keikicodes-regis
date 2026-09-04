# The trial task brief, verbatim

*Received on OnlineJobs 4 September 2026, 10:11 AM Manila. Sent from stephen@keikicoders.com,
signed "Peter". This is the assignment. Do not paraphrase it from memory; read it here.*

---

Hi Jhon,

I just cancelled our interview since my schedule adjusted while traveling, sorry about that! For
the interview process, instead of starting with a chat we'd actually like you to build a demo and
send a recorded walkthrough. We'll pay you $25 via Wise for your time.

**What to build**

A parent registration system for after-school classes that run on school campuses. Parents
register their kids online and pay at registration.

Rules that matter:

- A class has a school, a schedule (Tuesdays 3-4pm for 10 weeks), a capacity, and a price
- A parent can have multiple children, and a child can be in multiple classes
- Payment happens at registration via Stripe
- Parents can see their registrations and request a cancellation
- Kids sometimes join mid-semester, or drop
- Sessions occasionally get canceled for holidays or rescheduled

Use whatever stack and tools you want, including AI. We're focused on structure and the decisions
behind it.

**What to send: a Loom**

**Part 1: Something you've already built.** Ideally a live app with real users. Open the code.
Focus on the parts closest to what we're doing: how you handled authentication and different user
permissions, any payment or third-party integration, how the data is modeled, and what you do when
something fails. Tell us what was hard and what you'd do differently now.

**Part 2: Your demo.**

- Walk us through it, including what tools you used to build it
- Your data model and why you structured it that way
- A parent submits the registration form. Walk us through exactly what gets created and in what
  order. How do you know if the parent already exists? What if they register two kids in the same
  submission? What happens if the payment succeeds but the record creation fails halfway? What if
  the same submission comes in twice?
- Registration opens at 8am and 50 parents hit a class with 12 seats. How do you make sure it
  doesn't oversell?
- What would you deliberately leave out of v1?
- What would you need to know about our existing system before building this for real?

**Details**

Include your Wise email or phone number with your Loom and we'll send the $25 when we receive it.

Please send within 5 days (earlier is better), but let me know if you'd like more time. Reply with
any questions.

Peter

---

## Reading notes

- **"request a cancellation"**, not cancel. That is an approval flow, not self-service.
- **No waitlist is mentioned anywhere.** Confirmed by re-reading. Do not build one.
- **"structure and the decisions behind it"** is the grading rubric. Five of their seven questions
  are about failure and concurrency, not features.
- **"What would you deliberately leave out of v1"** is an explicit invitation to scope down and
  defend it. Building extra unrequested things scores worse, not better.
- Deadline: 5 days from 4 September, so **9 September**. Target 8 September.
