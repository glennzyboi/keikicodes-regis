/**
 * A visual identity per program.
 *
 * Six classes rendered as six identical white cards makes a parent read every
 * one to find the one they want. Giving each program a colour and a mark means
 * the Scratch class is recognisable before the title is read, and a family
 * coming back next term is looking for a shape they already know.
 *
 * The palette stays inside their brand: greens, the yellow, and two supporting
 * tones pulled from the same family rather than invented from a colour wheel.
 */
export type Art = {
  accent: string;
  soft: string;
  ink: string;
  mark: React.ReactNode;
  tag: string;
};

const ART: Record<string, Art> = {
  scratch: {
    accent: "#ff9f1c",
    soft: "#fff4e3",
    ink: "#7a4a00",
    tag: "First code",
    mark: (
      <>
        <rect x="4" y="5" width="16" height="5" rx="2.5" />
        <rect x="6" y="12" width="14" height="5" rx="2.5" />
        <path d="M8 19h9" />
      </>
    ),
  },
  roblox: {
    accent: "#2e9e74",
    soft: "#e8f5ef",
    ink: "#0f5740",
    tag: "Build a world",
    mark: (
      <>
        <path d="M12 3 20.5 8v8L12 21 3.5 16V8z" />
        <path d="M3.5 8 12 13l8.5-5M12 13v8" />
      </>
    ),
  },
  minecraft: {
    accent: "#5c8a3a",
    soft: "#eef5e7",
    ink: "#2f4a1c",
    tag: "Modding",
    mark: (
      <>
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
        <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
      </>
    ),
  },
  robotics: {
    accent: "#e05252",
    soft: "#fdeeee",
    ink: "#7a2222",
    tag: "Hands on",
    mark: (
      <>
        <rect x="4" y="8" width="16" height="11" rx="3" />
        <path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" />
      </>
    ),
  },
  python: {
    accent: "#1b7a5a",
    soft: "#e6f2ed",
    ink: "#0f5740",
    tag: "Real code",
    mark: (
      <>
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
      </>
    ),
  },
  web: {
    accent: "#7b61c9",
    soft: "#f1edfb",
    ink: "#42327a",
    tag: "Ship a site",
    mark: (
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="M3 9h18M6.5 6.7h.01M9 6.7h.01" />
      </>
    ),
  },
};

const FALLBACK: Art = {
  accent: "#1b7a5a",
  soft: "#e6f2ed",
  ink: "#0f5740",
  tag: "Coding",
  mark: (
    <>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
    </>
  ),
};

/** Matched on the title so a new class picks up art without a code change. */
export function artFor(title: string): Art {
  const key = Object.keys(ART).find((k) => title.toLowerCase().includes(k));
  return key ? ART[key] : FALLBACK;
}

export function ProgramMark({ title, size = 22 }: { title: string; size?: number }) {
  const art = artFor(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {art.mark}
    </svg>
  );
}
