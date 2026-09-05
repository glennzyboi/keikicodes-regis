"use client";

import { Honu } from "@/components/honu";
import { useCallback, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { HERO_DURATION, HERO_FPS, HeroFilm } from "./hero-film";

/**
 * The Remotion player, loaded only in the browser and only when it is wanted.
 *
 * Three separate decisions here, and each one is about not making somebody pay
 * for the animation.
 *
 * **`ssr: false`.** The Player reads layout and requestAnimationFrame; there is
 * nothing for it to do on the server, and rendering it there costs a hydration
 * mismatch for no benefit.
 *
 * **A poster while it loads.** Remotion is a real dependency and this is a
 * marketing page, so the first paint is a static version of the same scene, in
 * the same box, with the same background. Nothing shifts when the player takes
 * over, because the poster is the right size before it does.
 *
 * **`prefers-reduced-motion` wins outright.** Not "slower", not "shorter": the
 * poster stays and the player is never loaded at all. Somebody who has asked
 * their operating system for less motion should not be sent a video library.
 */
const Player = dynamic(() => import("@remotion/player").then((m) => m.Player), {
  ssr: false,
});

export function HeroStage() {
  // Subscribed rather than sampled into state. The server snapshot is "reduce
  // motion", so the still is what renders before hydration and what stays for
  // anybody who asked for less movement; the player is only ever reached on the
  // client, by someone who did not.
  const subscribe = useCallback((notify: () => void) => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  }, []);

  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <div className="kc-stage" aria-hidden>
      {ready && !reduced ? (
        <Player
          component={HeroFilm}
          durationInFrames={HERO_DURATION}
          fps={HERO_FPS}
          compositionWidth={720}
          compositionHeight={520}
          style={{ width: "100%", height: "100%" }}
          autoPlay
          loop
          controls={false}
          clickToPlay={false}
          doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause={false}
        />
      ) : (
        <HeroPoster />
      )}
    </div>
  );
}

/**
 * The still. Deliberately the same scene at rest rather than a grey box, so the
 * page looks finished before any JavaScript arrives and stays looking finished
 * for anybody who never gets it.
 */
function HeroPoster() {
  return (
    <div className="kc-stage-poster">
      {/* The same honu at rest: literally the same component the film animates
          and the sign in page shows, rather than a third copy of the paths.
          Three copies is how it drifted in the first place. */}
      <Honu title="Keiki Coders" style={{ width: 330 }} />

      <div className="kc-stage-steps">
        {["Pick the class", "Add your keiki", "Pay once"].map((label, i) => (
          <span key={label} className="kc-stage-step">
            <span className="kc-stage-step-n">{i + 1}</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
