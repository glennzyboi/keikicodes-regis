# Keiki Coders: the company

*Last verified 4 September 2026, from keikicoders.com and their OnlineJobs posting 1719232.*

## What they do

Keiki Coders teach children to code, build and play sports. "Keiki" is Hawaiian for child.
They describe themselves as **Hawaii's number one kids tech program**, and they position their
offer as turn-key: they supply the curriculum, the equipment and the trained instructors, and
they handle registration, parent communication and instruction. The partner schools supply the
venue and the children.

## Scale, in their own numbers

- **20+ schools** across Oahu
- **Over 1,500 children** taught so far
- Named partner schools on their site include **Iolani School**, **Maryknoll School**,
  **Kalani High School**, plus a number of public elementary schools
- Global contact address: hello@keikicoders.com

## Programs

- **After School Programs** run at partner school campuses during the academic semester
- **School Summer Programs**, day programs on partner campuses over the summer break
- **Summer of Code (2027)**, their own flagship summer program, currently taking early registration

Parents register at `/register` and browse at `/find-a-program`, currently advertising Fall 2026.

## Why this matters for the build

The business shape drives the data model. They are a **provider operating inside someone else's
building**, on a **term-based calendar**, with **a roster of children who are not the customers**.
The paying party is the parent, the attending party is the child, and the venue is a third party
whose calendar imposes holidays and closures. That is why:

- a class belongs to a **school**, not to Keiki
- sessions are **individual rows**, because a school holiday cancels one week and not the term
- a **child** is a first-class entity distinct from the **parent** who pays

## Related brands

Their job posting says new brands launch regularly and each one runs on whatever the internal
system provides. Anything built for them should not hard-code "Keiki Coders" as the only tenant.
