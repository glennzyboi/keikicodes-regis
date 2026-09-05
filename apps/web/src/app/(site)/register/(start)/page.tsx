import Link from "next/link";
import { cachedCampuses } from "@/lib/catalogue-cache";
import { currentParent } from "@/lib/parent-auth";
import { SchoolPicker } from "../../school-picker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Register — Keiki Coders",
  description: "Register your keiki for an after school class. It takes about two minutes.",
};

/**
 * The front of the registration flow.
 *
 * Their own form opens with "Select a school" and then filters the programs to
 * that school, which is right and is copied here deliberately. What is
 * different is everything after it.
 *
 * Their form is one student per submission. A family with two keiki fills in
 * the whole thing twice, types both parents' names and phone numbers twice, and
 * pays twice. Ours puts two children on one order and one payment, which is the
 * single most visible improvement in the build and costs nothing, because the
 * order and seat hold model already handles it.
 *
 * A returning parent is never asked for what is already on file. Their form
 * asks everything from scratch every term.
 *
 * This page is deliberately three sentences and a school picker. It is a step
 * on the way to a form, not a place to sell: somebody who clicked "Register"
 * has already decided.
 */
export default async function RegisterStart() {
  const campuses = await cachedCampuses();
  const parent = await currentParent();

  // Only the campuses that actually sell here. Sending somebody down a
  // registration flow that ends in "this school takes its own registrations"
  // is a dead end they walked into on our invitation.
  const sellable = campuses.filter((c) => !c.allExternal);
  const externalOnly = campuses.length - sellable.length;

  return (
    <section className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
      <span className="kc-eyebrow">Register</span>
      <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-green-900 sm:text-5xl">
        Let&apos;s get your keiki <span className="kc-highlight">signed up</span>
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-soft">
        Start with the school your child goes to. It takes about two minutes, and if you
        have more than one child they go on the same form and the same payment.
      </p>

      <div className="kc-card mt-10 p-6 sm:p-8">
        <SchoolPicker
          campuses={sellable}
          label="Step 1. Which school does your child go to?"
          placeholder="Start typing, for example Wai'alae"
        />

        <ol className="mt-8 space-y-4 border-t border-hairline pt-6">
          {[
            ["Pick the class", "Only the ones open to your child's grade, with the seats left shown live."],
            ["Add your keiki", "One form for the whole family. A second child joins the same order."],
            ["Pay once", "Card payment through Stripe. Your seat is held while you pay."],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span className="kc-step-number flex-none">{i + 2}</span>
              <span>
                <span className="block font-display font-bold text-green-900">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-ink-soft">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {!parent && (
        <p className="mt-6 text-sm leading-relaxed text-ink-soft">
          You will be asked to sign in before paying, so your registrations are yours and
          nobody else can see or cancel them.{" "}
          <Link href="/login?next=%2Fregister" className="kc-link">
            Sign in now
          </Link>{" "}
          if you already have an account.
        </p>
      )}

      {externalOnly > 0 && (
        <p className="mt-6 rounded-xl border border-hairline bg-white px-5 py-4 text-sm leading-relaxed text-ink-soft">
          {externalOnly} of our {campuses.length} campuses take registrations through their own
          school office, so they are not listed above. You can still see what we run there on
          the{" "}
          <Link href="/programs" className="kc-link">
            programs page
          </Link>
          , with a link straight to the school.
        </p>
      )}
    </section>
  );
}
