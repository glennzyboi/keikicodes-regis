"use client";

import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "./ui";
import { uploadProgramImage, uploadCampusLogo } from "./catalogue-actions";

/**
 * A picture, replaced in place.
 *
 * The catalogue always had somewhere to put a program's image and a campus's
 * logo, and the only way to set one was to paste a URL into a text box. That is
 * not a field an office can use. The picture they have is on somebody's phone or
 * in a shared folder, and "get it onto a public URL first" is the step where a
 * person gives up and leaves it blank, which is why plenty of their records have
 * no picture at all.
 *
 * Three things this does that the URL box could not:
 *
 *  - **Shows what is there now**, at the size it will actually appear, so you
 *    can tell a wrong picture from a missing one without opening a second tab.
 *  - **Submits on choose.** There is no separate Save. Picking a file is the
 *    whole intent; making somebody then find a button is the step that gets
 *    missed, and a half-completed upload looks exactly like a working one.
 *  - **Says what happened.** Including the part people do not expect: changing a
 *    program's picture changes it at every campus running that program, because
 *    the picture belongs to the curriculum. Silently changing five classes is
 *    worse than saying so.
 */
export function ImageField({
  kind,
  id,
  url,
  label,
  note,
}: {
  kind: "program" | "campus";
  id: string;
  url: string | null;
  label: string;
  note?: string;
}) {
  const action = kind === "program" ? uploadProgramImage : uploadCampusLogo;
  const [state, formAction, pending] = useActionState(action, null as
    | { ok: true; message: string }
    | { ok: false; error: string }
    | null);

  const formRef = useRef<HTMLFormElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  /**
   * Whether this control is actually wired up yet.
   *
   * Picking a file submits the form from the change handler, and that handler
   * only exists once React has hydrated. Between the HTML arriving and that
   * moment the button looks completely ready and does nothing at all: the file
   * is chosen, no upload starts, and the only feedback is that nothing happens.
   *
   * A person is unlikely to beat hydration to it. A test does it every time,
   * which is how this surfaced: the spec passed alone, where a cold compile made
   * the page slow enough, and failed in a suite where the page was already warm.
   * That is a real hole rather than a test artefact, so the control says when it
   * is ready instead of pretending.
   */
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className="ops-imagefield"
      data-ready={ready || undefined}
    >
      <input type="hidden" name={kind === "program" ? "programId" : "schoolId"} value={id} />

      <div className="ops-imagefield-preview" data-empty={url || chosen ? undefined : "true"}>
        {chosen || url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={chosen ?? url ?? ""} alt="" />
        ) : (
          <Icon name="image" size={20} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="ops-label">{label}</p>
        {note && <p className="mt-0.5 text-[var(--ops-muted)]">{note}</p>}

        <label className="ops-btn mt-2 inline-flex cursor-pointer" data-disabled={!ready || undefined}>
          {!ready ? "Loading…" : pending ? "Uploading…" : url ? "Replace" : "Upload"}
          <input
            type="file"
            name="file"
            className="sr-only"
            // Inert until the change handler that submits the form exists.
            // Otherwise the file is chosen, nothing uploads, and nothing says so.
            disabled={!ready || pending}
            // No `capture`: on a phone that attribute opens the camera and takes
            // away any route to the photo library, which is the same defect the
            // parent-facing photo field shipped with.
            accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              // Show it immediately. The upload takes a moment and an unchanged
              // thumbnail during it reads as nothing having happened.
              setChosen(URL.createObjectURL(file));
              formRef.current?.requestSubmit();
            }}
          />
        </label>

        {state && (
          <p
            role="status"
            aria-live="polite"
            className={`ops-note mt-2 ${state.ok ? "ops-note-good" : "ops-note-bad"}`}
          >
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}
