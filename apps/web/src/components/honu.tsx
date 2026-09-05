/**
 * The Keiki Coders honu, drawn from their actual mark.
 *
 * The first version was drawn from a memory of the logo rather than from the
 * logo, and it showed. Rather than nudge it again, every part of this is placed
 * from proportions measured off `public/icon.png`, expressed against the shell's
 * half width so they stay true at any size:
 *
 *   shell            ellipse, 1.24 : 1, tilted 16 degrees
 *   head radius      0.53 of the shell's half width
 *   head centre      (+0.97, -0.72) from the shell's centre, so it OVERLAPS
 *   eye              (-0.21, -0.19) from the head's centre, radius 0.19
 *   code symbol      (+0.44, +0.22) from the shell's centre, 0.30 wide
 *   light plates     the left 58 per cent of the carapace
 *
 * Three things were wrong before and each is the kind of error that reads as
 * "deformed" without anybody being able to name it:
 *
 *  1. **The head floated.** It was a circle clear of the shell's right edge with
 *     a thin stroke doing duty as a neck. In the mark it overlaps the shell by
 *     about a third of its width and there is no neck at all, because you are
 *     looking at a turtle from above.
 *  2. **The plates were a grid.** Straight rules across a rectangle clipped to
 *     an ellipse, which reads as a window, not a shell. A carapace is tiled: a
 *     ring of narrow marginal scutes around the rim and broader plates inboard,
 *     every seam curving with the shell.
 *  3. **The `</>` was centred.** It sits below and right of the middle, on the
 *     teal, clear of the head.
 *
 * The plates are drawn inside a clip path of the shell ellipse. That is the
 * detail that keeps it honest at every size: plate shapes are approximate by
 * nature, and clipping means an approximate shape can never spill past the rim
 * and produce the lumpy silhouette that made the last one look wrong. The rim
 * is stroked over the top, so the outline is one continuous ellipse rather than
 * the sum of whatever the plates happened to do.
 *
 * Every animated quantity is a prop with a settled default, so the still poster
 * and the Remotion film are the same drawing rather than two drawings that have
 * to be kept in step.
 */

export const HONU_OUTLINE = "#173f4c";
export const HONU_SHELL = "#399681";
export const HONU_LIGHT = "#76b06a";

export function Honu({
  /** 1 is open, 0 is shut. Scales the eye vertically the way a lid does. */
  blink = 1,
  /** Degrees. The long paddle, which is the one that does the swimming. */
  frontFlipper = 0,
  /** Degrees. The two short rear paddles, trailing the front one. */
  backFlipper = 0,
  /** 0 to 1. The shell plates settling into place. */
  plates = 1,
  /** 0 to 1. How much of the code symbol has been drawn. */
  code = 1,
  /** The ground behind it, used for the catchlight in the eye. */
  paper = "#ffffff",
  title = "Keiki Coders",
  className,
  style,
}: {
  blink?: number;
  frontFlipper?: number;
  backFlipper?: number;
  plates?: number;
  code?: number;
  paper?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Two honu on one page is not a case this has, and a stable id keeps the
  // markup identical between server and client. useId would force this whole
  // component to be a client component for the sake of a clip path.
  const clip = "honu-shell-clip";

  // Long enough to cover the longest of the three strokes, so the symbol draws
  // on rather than fading in.
  const DASH = 130;
  const drawn = Math.max(0, Math.min(1, code));

  return (
    <svg viewBox="0 0 300 285" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>

      <defs>
        <clipPath id={clip}>
          <ellipse cx="145" cy="150" rx="92" ry="74" transform="rotate(-16 145 150)" />
        </clipPath>
      </defs>

      {/*
        Flippers first, so the shell covers where they join it. Drawing them
        after would need a mask to hide the join, which is three more shapes to
        get subtly wrong. Every tip is rounded rather than pointed: a pointed
        paddle reads as a leaf, which is what the last pass looked like.
      */}
      <g transform={`rotate(${backFlipper} 126 208)`}>
        <path
          d="M108 192c-20 16-38 40-40 60 0 8 8 12 16 8 16-10 28-34 34-54z"
          fill={HONU_LIGHT}
          stroke={HONU_OUTLINE}
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <path
          d="M144 200c-10 22-14 48-8 62 3 7 12 7 17 0 11-16 15-38 13-56z"
          fill={HONU_LIGHT}
          stroke={HONU_OUTLINE}
          strokeWidth="8"
          strokeLinejoin="round"
        />
      </g>

      <g transform={`rotate(${frontFlipper} 110 176)`}>
        <path
          d="M118 152c-38 4-80 18-104 36-6 8-2 18 8 20 34 4 70-6 102-22z"
          fill={HONU_LIGHT}
          stroke={HONU_OUTLINE}
          strokeWidth="8"
          strokeLinejoin="round"
        />
      </g>

      {/* Shell body */}
      <ellipse
        cx="145"
        cy="150"
        rx="92"
        ry="74"
        transform="rotate(-16 145 150)"
        fill={HONU_SHELL}
      />

      {/*
        Plates. Never from scale(0): they grow from most of their size, so it
        reads as settling rather than as appearing out of nothing.
      */}
      <g
        clipPath={`url(#${clip})`}
        opacity={plates}
        transform={`translate(145 150) scale(${0.92 + 0.08 * plates}) translate(-145 -150)`}
      >
        <g transform="rotate(-16 145 150)">
          {/* The lighter front of the carapace, with a seam that curves. */}
          <path
            d="M34 40h116c16 52 16 168 0 220H34z"
            fill={HONU_LIGHT}
            stroke={HONU_OUTLINE}
            strokeWidth="7"
            strokeLinejoin="round"
          />
          <g stroke={HONU_OUTLINE} strokeWidth="7" fill="none" strokeLinecap="round">
            {/*
              Four seams, and not one more.

              A ring of narrow marginal scutes around the rim, split by two short
              seams that run out to the edge, and one seam across the inner
              plates. Earlier passes drew six or seven, fanning in several
              directions at once, and the shell stopped reading as a shell: at
              the size this is actually used, extra seams are noise that turns
              into a scribble. Curved and concentric with the rim, because a
              straight seam is what made it look like a beetle's back.
            */}
            <path d="M104 56C82 86 74 118 74 150s8 64 30 94" />
            <path d="M76 116L48 108M76 184L48 192" />
            <path d="M78 150h72" />
          </g>
        </g>
      </g>

      {/* The rim, over the top, so the silhouette is one clean ellipse. */}
      <ellipse
        cx="145"
        cy="150"
        rx="92"
        ry="74"
        transform="rotate(-16 145 150)"
        fill="none"
        stroke={HONU_OUTLINE}
        strokeWidth="9"
      />

      {/*
        The code symbol, written on. strokeDashoffset rather than opacity, so it
        draws the way a child would draw it, left to right.
      */}
      <g
        transform="rotate(-16 145 150)"
        fill="none"
        stroke={HONU_OUTLINE}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={DASH}
        strokeDashoffset={DASH - DASH * drawn}
      >
        <path d="M172 158l-15 18 15 18" />
        <path d="M178 198l12-44" />
        <path d="M196 158l15 18-15 18" />
      </g>

      {/* Head, over the shell rather than beside it. */}
      <ellipse
        cx="233"
        cy="85"
        rx="51"
        ry="48"
        fill={HONU_LIGHT}
        stroke={HONU_OUTLINE}
        strokeWidth="9"
      />
      <ellipse cx="222" cy="76" rx="9.7" ry={9.7 * Math.max(0.06, blink)} fill={HONU_OUTLINE} />
      <circle cx="226" cy="70.5" r="3.3" fill={paper} opacity={blink} />
      <path
        d="M243 99c8 13 23 13 30 1"
        fill="none"
        stroke={HONU_OUTLINE}
        strokeWidth="7"
        strokeLinecap="round"
      />
      <ellipse cx="266" cy="88" rx="4.6" ry="3.5" fill={HONU_OUTLINE} transform="rotate(-28 266 88)" />
    </svg>
  );
}
