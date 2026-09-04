/**
 * A visual identity per program.
 *
 * Twenty-eight offerings rendered as twenty-eight identical white cards makes a
 * parent read every one to find the one they want. Giving each subject a colour
 * and a mark means the Tinker Lab class is recognisable before the title is
 * read, and a family coming back next term is looking for a shape they know.
 *
 * Keyed on the program's subject rather than guessed from a substring of the
 * title, which is what it used to do. Their catalogue has "Code Heroes: Virtual
 * Reality" and "Code Explorers: Virtual Reality" as different programs at
 * different levels; those are the same subject and should look like it. The
 * level comes from the track and is shown as the tag, so the ladder their
 * naming already describes is visible.
 *
 * The palette stays inside their brand: greens, the yellow, and supporting
 * tones pulled from the same family rather than invented from a colour wheel.
 */
export type Art = {
  accent: string;
  soft: string;
  ink: string;
  mark: React.ReactNode;
};

const VIRTUAL_REALITY: Art = {
  accent: "#6d5ae0",
  soft: "#efedfc",
  ink: "#3b2f8f",
  mark: (
    <>
      <path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v3a2.5 2.5 0 0 1-2.5 2.5h-2.2a2 2 0 0 1-1.5-.7l-1-1.1a1.2 1.2 0 0 0-1.8 0l-1 1.1a2 2 0 0 1-1.5.7H5.5A2.5 2.5 0 0 1 3 12.5Z" />
      <path d="M7 18.5 8 21M17 18.5 16 21" />
    </>
  ),
};

const TINKER_LAB: Art = {
  accent: "#e0762a",
  soft: "#fdf0e4",
  ink: "#8a4210",
  mark: (
    <>
      <path d="M14.5 3.5a4 4 0 0 0-5 5L4 14v6h6l5.5-5.5a4 4 0 0 0 5-5l-3 3-2.5-2.5Z" />
      <path d="M7 17h.01" />
    </>
  ),
};

const STOP_MOTION: Art = {
  accent: "#c9457f",
  soft: "#fdeaf2",
  ink: "#83214d",
  mark: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3Z" />
      <path d="M6 6V4M11 6V4" />
    </>
  ),
};

const ANIMATION_STUDIO: Art = {
  accent: "#d4a017",
  soft: "#fdf6e0",
  ink: "#7a5c00",
  mark: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9" cy="9.5" r="1.2" />
      <circle cx="15" cy="9.5" r="1.2" />
      <circle cx="8.5" cy="14.5" r="1.2" />
      <path d="M12 20.5c1.5 0 2-1 1.4-2s.2-2 1.6-2h2" />
    </>
  ),
};

const DIGITAL_STORYTELLING: Art = {
  accent: "#2f8fbf",
  soft: "#e6f3f9",
  ink: "#15556f",
  mark: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    </>
  ),
};

const CODING_FOUNDATIONS: Art = {
  accent: "#1b7a5a",
  soft: "#e6f2ed",
  ink: "#0f5740",
  mark: (
    <>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </>
  ),
};

const FALLBACK: Art = {
  accent: "#1b7a5a",
  soft: "#e6f2ed",
  ink: "#0f5740",
  mark: (
    <>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
    </>
  ),
};

/**
 * Subject to art, matched on the words their catalogue actually uses.
 *
 * Order matters: "Animation Studio: Stop-Motion & Design" contains both
 * "animation" and "stop-motion", and it is an animation class.
 */
const BY_SUBJECT: [RegExp, Art][] = [
  [/virtual reality|\bvr\b/i, VIRTUAL_REALITY],
  [/animation studio/i, ANIMATION_STUDIO],
  [/tinker lab/i, TINKER_LAB],
  [/stop.?motion/i, STOP_MOTION],
  [/storytell|digital story/i, DIGITAL_STORYTELLING],
  [/coding foundations|coding|python|scratch|web design/i, CODING_FOUNDATIONS],
];

/** What a program looks like. Pass the subject if you have it, else the title. */
export function artFor(subjectOrTitle: string | null | undefined): Art {
  if (!subjectOrTitle) return FALLBACK;
  for (const [pattern, art] of BY_SUBJECT) {
    if (pattern.test(subjectOrTitle)) return art;
  }
  return FALLBACK;
}

export function ProgramMark({
  subject,
  size = 22,
}: {
  subject: string | null | undefined;
  size?: number;
}) {
  const art = artFor(subject);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {art.mark}
    </svg>
  );
}
