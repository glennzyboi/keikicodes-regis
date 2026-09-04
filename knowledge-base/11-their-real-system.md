# Their real registration system, as it runs today

*Investigated 4 September 2026 by reading keikicoders.com and the form behind it.
This is the evidence behind every modelling decision in the build. None of it
came from them telling us; all of it is publicly visible.*

---

## The shape of it

```
Squarespace site
  /find-a-program   code block  ->  n8n webhooks  ->  Airtable
  /register         Fillout embed 68xVk83zFxus  ->  Airtable (RecordPicker)
                                                ->  Stripe (live, one-time)
```

n8n is already their read API. Two public, unauthenticated GET endpoints:

| Endpoint | Returns |
|---|---|
| `https://n8n.keikicoders.com/webhook/get-programs` | 28 programs |
| `https://n8n.keikicoders.com/webhook/get-schools` | 19 schools |

Captured to `KeikiCoders/fixtures/keikicoders-catalogue-2026-09-04.json`.

**Program record**
`name, grades, season, site, location, days, time, dates, cost, sessions,
image, specialNotes, description, registerUrl, noClass`

**School record**
`name, logo, area, type`

Logos and program images are `v5.airtableusercontent.com` URLs, which are
signed and expire. Anything we import has to copy them, not link them.

---

## What the numbers say

| Measure | Value |
|---|---|
| Schools listed | 19 |
| Schools with at least one program | 15 |
| Schools with none | Kahala, Waikiki, Aina Haina, Kainalu |
| Program offerings | 28 |
| Distinct program names | **13** |
| Offerings registered and paid on keikicoders.com | **13** |
| Offerings registered on the school's own website | **15** |
| Offerings with blackout dates | 25 |
| Distinct weekdays used | 5, always exactly one per offering |

`cost != null` and `registerUrl` being on keikicoders.com are the **same 13
rows**. So registration mode is derivable with no guessing.

Grade ranges in use: `K-1, K-2, 1, 1-3, 1-4, 2-3, 2-5, 3-5, 3-6, 4-5, 4-6, 6-8`.

---

## Program is a curriculum, offering is an instance

13 names across 28 rows. "Code Heroes: Virtual Reality" runs at Hanahau'oli,
Holy Nativity, Maryknoll, St. Louis and Wai'alae, each with its own grades,
weekday, times, term dates, blackouts and price. Their naming already encodes a
level tier:

```
Code Explorers  /  Code Juniors  /  Code Heroes  /  Code Masters
STEM Explorers  /  STEM Juniors
Creative Explorers  /  Creative Heroes
```

then a subject: Virtual Reality, Tinker Lab, Coding Foundations, Stop-Motion
Movie Makers, Animation Studio, Digital Storytellers.

---

## The schedule rule, verified

Sessions are **every occurrence of the weekday from the first date to the last
date, minus the blackout dates.**

`noClass` is a comma separated list of US-format dates with inconsistent
padding and years: `"10/07/26, 11/4/26, 11/11/26"`, `"12/4/2026"`.

Checked against their own stated `sessions` count:

| Offering | Window | Weekday | Occurrences | Blackouts | Expected | They say |
|---|---|---|---|---|---|---|
| Hokulani Tinker Lab | 12 Aug to 16 Dec | Wed | 19 | 3 | 16 | 16 |
| Iolani Digital Storytellers | 12 Aug to 16 Dec | Wed | 19 | 2 applicable | 17 | 17 |

Iolani lists `11/27/26` as a blackout, which is a **Friday**, on a Wednesday
class. It is silently ignored. Their blackout lists are copied between programs
at a campus and never validated against the class weekday. Our importer must
ignore non-matching dates the same way, or the counts will not reconcile.

---

## The Fillout form

Form id `68xVk83zFxus`. Steps:

1. **Select a school** (RecordPicker on Airtable)
2. **Program + Student**
3. **Parent + Consent**
4. **Parent 2** (optional)
5. **Payment** (Stripe checkout step)
6. **Ending**, with an alert on success

Plus three branches: **Ending Private School**, **Pre-register**, and a cover
called **Max Enrollment**.

### Every field it collects

| Field | Type | Required |
|---|---|---|
| School | RecordPicker | yes |
| Program | RecordPicker, filtered by school | yes |
| Student First Name | short answer | yes |
| Student Last Name | short answer | yes |
| Student Grade | dropdown | yes |
| Student Photo (head shot) | file upload | **yes** |
| Student in an afterschool care program? (A+ / W+ / etc) | checkbox | no |
| "I understand my child must be enrolled in and attending the school where the program is offered" | checkbox | yes |
| Additional notes | long answer | no |
| Parent 1 Name / Email / Phone | | yes |
| Parent 2 Name | short answer | **no** |
| Parent 2 Email / Phone | | **yes** |
| Policy consent: participation, safety, cancellation | checkbox | yes |
| Newsletter and marketing opt-in | checkbox | no |
| How did you hear about us? | dropdown | yes |
| Term | RecordPicker, hidden, default `rec5mAq1uDdpiMFey` | no |

Parent 2 Name being optional while Parent 2 Email and Phone are required is a
bug in their form, not a rule.

There is also a leftover `School Deprecated` RecordPicker still in the form.

### Payment

Fillout mints a one-time Stripe charge with a **dynamic amount pulled from
Airtable at checkout time**:

```
price       = Program['Program Cost']
title       = Program['Program']
description = Program['Schedule']
```

There are no Stripe Products or Prices per class. Discounts are enabled, card
only, receipt sent by Stripe. The submission writes back to Airtable including
`stripePaymentUrl` and the School record id.

---

## Where the business rules actually live

This is the part that matters, and it is the argument for the whole build.

**The Program picker filter, in the form builder:**

```
Program.Site           =  <the school the parent just picked>
Program.Term           =  "Fall 2026"      <- typed string
Program.RegisteredBy   =  "Keiki Coders"   <- typed string
Program.<full flag>    is_empty
```

**The School picker filter, in the form builder:**

```
School.<term field>  contains  "Fall 2026"
School.Name  !=  "St. Andrews School"
School.Name  !=  "Hawaii Baptist Academy"
School.Name  !=  "Test School"
School.Name  !=  "Hawaii Baptist Academy"     <- listed twice
```

So "which schools can be registered for this term" is a hand-maintained list of
exclusions inside a form builder. "Test School" is in production. One exclusion
is duplicated.

**Rolling to a new term means editing the form**, in at least three places: both
filter strings and the hidden Term record id.

**Capacity is not enforced by the system.** The `Max Enrollment` cover fires on
one hardcoded Airtable record id, `recmbDh812iEvD1Os`, and contains hand-typed
copy:

> Aloha Waikiki families! Please note that the Tinker Lab and Virtual Reality
> coding programs at Waikiki has reached full enrollment. We've opened a
> waitlist. **Please complete your registration to secure a spot on the
> waitlist.** Our team is reaching out to Principal Ryan to explore opening an
> additional session for both programs.

When a class fills, somebody opens the form builder and writes a page about it.
Waikiki Elementary now appears in `get-schools` with **zero** programs, so the
classes were pulled entirely.

That is their answer to "50 parents hit a class with 12 seats", and it is worth
being generous about it on camera: it works, it is honest with families, and it
was clearly written by someone who cared. It just cannot scale past the person
who knows to go and edit it.

---

## What this changes for us

1. Programs, schools and terms are entities, not strings on a class.
2. More than half their catalogue is registered elsewhere, so an offering needs
   a registration mode and an external URL, and must refuse to be sold.
3. Schedules are first date, last date, weekday and blackout dates.
4. Grades, not ages.
5. Capacity, "is it full", and "which schools are open this term" belong in
   data that the office can edit, not in a form builder.
6. Our form has to collect every field in the table above. Anything we drop is
   something their office loses.

---

## Deliberately not touched

Their n8n endpoints are read-only GETs and we only ever read them. Nothing here
writes to their Airtable, and no part of the demo submits their live Fillout
form, which would create a real record and a live Stripe charge.
