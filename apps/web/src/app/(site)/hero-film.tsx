"use client";

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Honu as SharedHonu } from "@/components/honu";

/**
 * The hero animation, as a Remotion composition.
 *
 * It is their **honu**, not an invented robot. Their logo is a sea turtle with
 * `</>` on its shell, which is the whole company in one shape: Hawaii, and
 * code, and something a seven year old would draw. The first version of this
 * page had a robot I made up, which was a worse idea in every respect. The
 * palette is sampled from `public/icon.png` rather than guessed: `#173f4c` for
 * the outline, `#399681` for the dark shell, `#76b06a` for the light green.
 *
 * Remotion rather than CSS keyframes, and the reason is that this is a **film**
 * rather than an interaction. It has a script: the honu swims in, the shell
 * plates settle, the code symbol on its shell draws itself, three steps land in
 * order, and a seat counter ticks down. Every frame is a pure function of
 * `frame`, so the timing lives in one place instead of a stack of nested
 * `animation-delay` values, and the same composition renders to an MP4 with
 * `remotion render`. They run Instagram and a Squarespace site, so a hero that
 * is also the source for a social clip is worth more than one that only exists
 * in a browser.
 *
 * Motion does the scroll reveals further down the page. The two are not
 * competing: Remotion owns the timeline, Motion owns what responds to a person.
 *
 * Same rules as everything else here. Nothing scales from zero, the springs are
 * gentle, and the whole thing is skipped under `prefers-reduced-motion`, which
 * the page checks before it ever loads the player.
 */

// The honu's own three colours now live with the drawing, in components/honu.tsx.
// What is left here is what the rest of the scene uses.
const OUTLINE = "#173f4c";
const SHELL = "#399681";
const SUN = "#ffcf33";
const PAPER = "#ffffff";

export const HERO_DURATION = 300;
export const HERO_FPS = 30;

function rise(frame: number, fps: number, delay: number, duration = 26) {
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: duration,
  });
}

export function HeroFilm() {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const small = width < 520;

  const beat = (n: number) => rise(frame, fps, 96 + n * 26);

  // The one number that makes the point: this is live, not a picture of a form.
  const seats = Math.round(
    interpolate(frame, [150, 215], [12, 3], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  // A slow swim, so it reads as floating rather than bobbing.
  const drift = Math.sin(frame / 34) * 7;
  const tilt = Math.sin(frame / 40) * 2.5;

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 100% at 68% 0%, #f2f8f4 0%, #e6f1ea 45%, #dcece3 100%)",
        fontFamily: "var(--font-poppins), ui-sans-serif, system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Water, suggested. Slow, low contrast, never the thing you look at. */}
      <AbsoluteFill style={{ opacity: 0.5 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${6 + i * 21}%`,
              top: `${16 + (i % 2) * 48}%`,
              width: 130,
              height: 130,
              borderRadius: "42% 58% 55% 45%",
              background: i % 2 ? SUN : SHELL,
              opacity: 0.08,
              transform: `translateY(${Math.sin((frame + i * 40) / 32) * 10}px)`,
            }}
          />
        ))}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `translateY(${drift - 34}px) rotate(${tilt}deg)`,
        }}
      >
        <Honu frame={frame} fps={fps} scale={small ? 0.66 : 1} />
      </AbsoluteFill>

      {/* ------------------------------------------------------------ steps */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: small ? 24 : 38,
        }}
      >
        <div style={{ display: "flex", gap: small ? 8 : 14, flexWrap: "nowrap" }}>
          {["Pick the class", "Add your keiki", "Pay once"].map((label, i) => {
            const t = beat(i);
            return (
              <div
                key={label}
                style={{
                  transform: `translateY(${interpolate(t, [0, 1], [16, 0])}px) scale(${interpolate(
                    t,
                    [0, 1],
                    [0.92, 1],
                  )})`,
                  opacity: t,
                  background: PAPER,
                  border: "1px solid #e4ece8",
                  borderRadius: 999,
                  padding: small ? "7px 12px" : "10px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 10px 24px -12px rgba(23,63,76,0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: small ? 18 : 22,
                    height: small ? 18 : 22,
                    borderRadius: 999,
                    background: OUTLINE,
                    color: PAPER,
                    fontSize: small ? 10 : 12,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: small ? 11 : 14, fontWeight: 600, color: OUTLINE }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* ------------------------------------------------------- seat ticker */}
      <div
        style={{
          position: "absolute",
          top: small ? 16 : 26,
          right: small ? 16 : 26,
          opacity: interpolate(frame, [136, 156], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          background: PAPER,
          border: "1px solid #e4ece8",
          borderRadius: 16,
          padding: small ? "8px 12px" : "11px 16px",
          boxShadow: "0 12px 28px -14px rgba(23,63,76,0.32)",
        }}
      >
        <div
          style={{
            fontSize: small ? 8.5 : 10,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: "#5b7480",
          }}
        >
          Seats left
        </div>
        <div
          style={{
            fontSize: small ? 22 : 30,
            fontWeight: 700,
            lineHeight: 1.1,
            color: seats <= 3 ? "#a86a00" : OUTLINE,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {seats}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Their honu, animated.
 *
 * The drawing itself lives in components/honu.tsx and is shared with the still
 * poster and the sign in page. It used to be three copies of the same paths in
 * three files, which is precisely how it drifted: the film, the poster and the
 * mark were slowly becoming different turtles, and the one everybody was
 * looking at had a head floating clear of its shell.
 *
 * What stays here is the timing, which is the only part that is actually about
 * the film. The build order is the point: the honu arrives, the shell plates
 * settle into it, and only then does the code symbol write itself. That is the
 * company own story, in the order they would tell it.
 */
function Honu({ frame, fps, scale }: { frame: number; fps: number; scale: number }) {
  const arrive = rise(frame, fps, 4, 34);
  const plates = rise(frame, fps, 26, 30);
  const code = rise(frame, fps, 58, 34);

  // Flippers paddle, slightly out of phase so it does not read as a machine.
  const front = Math.sin(frame / 15) * 9;
  const back = Math.sin(frame / 15 + 1.1) * 6;

  // One blink about every three seconds, and never on the first frame.
  const blink = frame % 92 > 85 ? 0.12 : 1;

  return (
    <SharedHonu
      blink={blink}
      frontFlipper={front}
      backFlipper={back}
      plates={plates}
      code={code}
      paper={PAPER}
      title="Keiki Coders"
      style={{
        width: 430 * scale,
        height: 408 * scale,
        opacity: arrive,
        transform: `scale(${interpolate(arrive, [0, 1], [0.92, 1])})`,
      }}
    />
  );
}
