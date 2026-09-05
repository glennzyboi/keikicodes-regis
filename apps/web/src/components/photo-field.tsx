"use client";

import { useId, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import "./photo-field.css";

/**
 * A head shot for one child.
 *
 * Their form requires this and does it with a bare file input, which on a phone
 * means a parent picks a 6MB photo, waits, and often fails. Three things here
 * are different, and all three are about the same parent standing in a car park
 * on a bad connection.
 *
 * The image is downscaled in the browser before it is uploaded. A 4000 pixel
 * photograph carries no more information than a 600 pixel one when the job is
 * "which of these children is Kaimana", and it uploads roughly fifty times
 * faster.
 *
 * It uploads immediately rather than on submit, so the slow part happens while
 * the parent is still filling in the rest of the form instead of after they
 * press pay.
 *
 * And it says what went wrong. "Upload failed" is not a message; "that file is
 * a PDF, we need a photo" is.
 */

const MAX_EDGE = 720;
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * What the file input offers, and what we will try to decode.
 *
 * HEIC and HEIF are here because that is what an iPhone photo library actually
 * contains, and leaving them out meant a parent picking a photo of their own
 * child was told "That is a HEIC file". What we *upload* is always JPEG, because
 * `downscale` re-encodes through a canvas, so the bucket's allowed types do not
 * change.
 *
 * The size cap is on the file chosen, not the file stored: a 12MP phone photo is
 * comfortably over 5MB before downscaling and about 80KB after it.
 */
const ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
];

/**
 * A random file name that works outside a secure context.
 *
 * `crypto.randomUUID` is undefined over plain HTTP on anything but localhost,
 * which is exactly how anyone tests on a phone against a laptop's LAN address.
 * It threw inside the try and surfaced as "We could not save that photo:
 * crypto.randomUUID is not a function", which sounds like the photo's fault.
 */
function randomName(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type State = "empty" | "working" | "done" | "error";

async function downscale(file: File): Promise<Blob> {
  // createImageBitmap handles EXIF orientation, which a canvas alone does not,
  // so portrait photos from a phone do not arrive sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not read that image"))),
      "image/jpeg",
      0.85,
    );
  });
}

export function PhotoField({
  parentId,
  value,
  onChange,
  label = "Photo of your child",
  required = false,
}: {
  parentId: string;
  value: string | null;
  onChange: (path: string | null) => void;
  label?: string;
  required?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(value ? "done" : "empty");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    // Clear the input straight away, so picking the SAME file again fires a
    // change event. Without this the obvious way to retry a failed upload,
    // choosing that photo once more, did nothing at all and the field looked
    // dead.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    // An empty file.type is normal, not a fault: some Android pickers and some
    // HEIC files report nothing at all. Let the decoder be the judge rather
    // than refusing on a header the OS declined to supply.
    if (file.type && !ACCEPT.includes(file.type)) {
      setState("error");
      setMessage(
        `That is a ${file.type.split("/")[1].toUpperCase()} file, which we cannot read. A photo from your camera roll will work.`,
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage("That photo is very large. Try one taken at a smaller size.");
      return;
    }

    setState("working");
    setMessage(null);

    try {
      let blob: Blob;
      try {
        blob = await downscale(file);
      } catch {
        // The browser could not decode it. On a desktop browser with no HEIC
        // support this is the honest answer, and it is a different problem from
        // the upload failing.
        throw new Error(
          "This browser cannot read that image. Try a JPEG or PNG, or pick it on your phone.",
        );
      }

      const key = `${parentId}/${randomName()}.jpg`;

      const { error } = await supabaseBrowser()
        .storage.from("child-photos")
        .upload(key, blob, { contentType: "image/jpeg", upsert: false });

      if (error) {
        // A storage policy refusal is almost always a signed out session, and
        // "row level security" is not a sentence to show a parent. The policy
        // keys on the parents row behind auth.uid(), so no session means no
        // folder to write into.
        const denied =
          /row-level security|violates|policy|jwt|unauthor/i.test(error.message) ||
          (error as { statusCode?: string }).statusCode === "403";
        throw new Error(
          denied
            ? "Your sign in seems to have expired. Please sign in again, then choose the photo."
            : error.message,
        );
      }

      setPreview(URL.createObjectURL(blob));
      setState("done");
      onChange(key);
    } catch (err) {
      setState("error");
      // The form is told, so a failed upload cannot be paid past unnoticed.
      onChange(null);
      setMessage(
        err instanceof Error && err.message
          ? err.message
          : "We could not save that photo. Try again, or pick a different one.",
      );
    }
  }

  function clear() {
    setPreview(null);
    setState("empty");
    setMessage(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="kc-photo">
      <label className="kc-label" htmlFor={id}>
        {label}
        {!required && <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>

      <div className="kc-photo-row">
        <div className="kc-photo-preview" data-state={state}>
          {preview ? (
            // A blob URL for the copy we just made, so no signed URL round trip
            // is needed to show the parent what they picked.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" />
          ) : state === "working" ? (
            <span className="kc-photo-spinner" aria-hidden />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="9" r="3.2" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
          )}
        </div>

        <div className="kc-photo-actions">
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={ACCEPT.join(",")}
            // No `capture`. It used to be capture="user", which on iOS Safari
            // and Android Chrome opens the FRONT camera and removes any route to
            // the photo library, so a parent could not pick a photo of their
            // child at all: the camera that opened was pointed at them. Without
            // it the OS offers camera and library both, which is the choice they
            // actually want.
            required={required && !value}
            onChange={(e) => handle(e.target.files?.[0])}
          />
          <button
            type="button"
            className="kc-btn kc-btn-quiet text-sm"
            onClick={() => inputRef.current?.click()}
            disabled={state === "working"}
          >
            {state === "working"
              ? "Saving..."
              : state === "done"
                ? "Choose a different photo"
                : "Choose a photo"}
          </button>
          {state === "done" && (
            <button type="button" className="kc-link text-sm" onClick={clear}>
              Remove
            </button>
          )}
          <p className="kc-photo-hint">
            {state === "error" ? (
              <span role="alert" className="kc-field-error">
                {message}
              </span>
            ) : state === "done" ? (
              "Saved. Only Keiki Coders staff can see it."
            ) : (
              "So the instructor knows who is in their class on the first day."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
