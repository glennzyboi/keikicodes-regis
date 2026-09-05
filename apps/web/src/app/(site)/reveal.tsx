"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Content that arrives as you reach it.
 *
 * Motion rather than an IntersectionObserver written by hand, for one reason
 * that matters: `whileInView` with `once` unsubscribes after it fires, so a
 * page with a dozen of these is not a dozen live observers for the rest of the
 * session.
 *
 * The rules are the same ones the rest of this build follows.
 *
 * **Never from scale(0) or from far away.** 14 pixels and 0.98, so it reads as
 * settling rather than flying in. A reveal you consciously notice is a reveal
 * that is too big.
 *
 * **ease-out, 420ms, no bounce.** This is a marketing page, so it can be a
 * little slower than a dropdown, but a spring with bounce on a paragraph of
 * text is decoration pretending to be physics.
 *
 * **`margin: "-80px"`.** It fires slightly before the element is fully on
 * screen, so by the time somebody's eye arrives the movement has finished. A
 * reveal that starts when the text is already being read is just text moving
 * while you read it.
 *
 * **Reduced motion turns it off entirely**, rather than shortening it. The
 * content is rendered, in place, with no transform at all: the point of the
 * setting is stillness, not speed.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, transform: "translateY(14px) scale(0.98)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.42, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts up when it comes into view.
 *
 * Used only on the three headline figures, and only once each. A counter is a
 * genuinely good use of animation: it makes the eye read the number rather than
 * skim past it. It would be a terrible one on anything a person sees often,
 * which is why it is on the marketing page and nowhere in the console.
 *
 * The final value is in the DOM from the first render, so a search engine, a
 * screen reader and anybody with reduced motion all see the real number rather
 * than a zero that never animates.
 */
export function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const reduced = useReducedMotion();
  if (reduced || to === 0) {
    return (
      <span>
        {to}
        {suffix}
      </span>
    );
  }

  return (
    <motion.span
      initial={{ opacity: 0.35 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
    >
      <motion.span
        initial={{ "--n": 0 } as never}
        whileInView={{ "--n": to } as never}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 1.1, ease: [0.23, 1, 0.32, 1] }}
        style={{ counterReset: "n var(--n)" } as React.CSSProperties}
        className="kc-count"
      />
      <span className="sr-only">{to}</span>
      {suffix}
    </motion.span>
  );
}
