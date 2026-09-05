import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * The one screen in the console that carries the brand.
 *
 * Everywhere behind this door is deliberately plain: an internal tool read for
 * six hours a day should not shout, and the rounded display type that sells a
 * class to a parent gets tiring at that duty cycle. A sign in page is the
 * exception, and the reason is not decoration. It is the only screen somebody
 * sees before they are signed in, which makes it the only screen where the
 * question is "is this the right system, and is it really theirs" rather than
 * "where is the thing I came to do". A plain grey box with two fields answers
 * neither, and looks equally like a phishing page.
 *
 * So: the honu, at size, on their teal, next to the form. Nothing moves and
 * nothing waits, because this is also the screen somebody hits at 7am when
 * something has gone wrong.
 *
 * It sits outside the (console) route group, which is what makes signing out
 * actually leave the console rather than swapping the page underneath a rail
 * that is still mounted.
 */
export default async function AdminLogin() {
  if (await currentStaff()) redirect("/admin");

  return (
    <div className="ops-login">
      <aside className="ops-login-brand">
        {/*
          Their actual logo file, not a redrawing of it.

          There was a hand-built SVG honu here and it kept being not quite right,
          which is the predictable outcome: a mark is a piece of artwork somebody
          drew, and approximating it by eye gets close and stays wrong in a way
          people notice without being able to say why. The one place an exact
          match matters most is the screen that says "this really is Keiki
          Coders", so this is the file itself.

          The drawn version still earns its place in the hero, where it has to
          move, and nothing static needs it.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="Keiki Coders" className="ops-login-mark" />

        <div>
          <p className="ops-login-sub">Registration operations</p>
        </div>
        <p className="ops-login-note">
          Every registration, roster, payment and message for the after school
          programs, in one place.
        </p>
      </aside>

      <main className="ops-login-panel">
        <div className="ops-login-form">
          <h1 className="text-[20px] font-semibold">Sign in</h1>
          <p className="mt-1.5 text-[var(--ops-muted)]">
            Staff accounts see every family&apos;s details, including children&apos;s
            photographs and medical notes, so this side needs a password. Parents
            sign in on the main site.
          </p>
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
