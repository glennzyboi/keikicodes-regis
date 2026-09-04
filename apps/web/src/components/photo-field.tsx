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
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

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
    if (!file) return;

    if (!ACCEPT.includes(file.type)) {
      setState("error");
      setMessage(
        file.type
          ? `That is a ${file.type.split("/")[1].toUpperCase()} file. We need a photo: JPEG, PNG or WebP.`
          : "We need a photo: JPEG, PNG or WebP.",
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage("That photo is larger than 5MB. Try one taken at a smaller size.");
      return;
    }

    setState("working");
    setMessage(null);

    try {
      const blob = await downscale(file);
      const key = `${parentId}/${crypto.randomUUID()}.jpg`;

      const { error } = await supabaseBrowser()
        .storage.from("child-photos")
        .upload(key, blob, { contentType: "image/jpeg", upsert: false });

      if (error) throw error;

      setPreview(URL.createObjectURL(blob));
      setState("done");
      onChange(key);
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error && err.message
          ? `We could not save that photo: ${err.message}`
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
            capture="user"
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
              <span role="alert" className="text-sun-deep">
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
