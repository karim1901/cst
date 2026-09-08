"use client";

import { useEffect, useRef, useState } from "react";

import { FIELD, LABEL, BUTTON_PRIMARY, BUTTON_SECONDARY, ALERT_ERROR, Spinner } from "@/app/_components/ui/form";

/**
 * Small note-entry modal, reused for both "Add to Follow-up" (Orders page)
 * and "Edit note" (the Follow-up page) — one implementation instead of
 * two nearly-identical dialogs. This is the app's first modal; built as a
 * self-contained `fixed inset-0` overlay + backdrop (same layering idea as
 * SidebarNav's mobile drawer backdrop) rather than pulling in a dialog
 * library for one use case.
 */
export default function NoteModal({ title, description, initialNote = "", saveLabel = "Save", onSave, onClose }) {
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose is a fresh function each render by design, not a dependency this effect should re-run for
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave(note.trim());
    } catch (err) {
      setError(err?.message || "Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        aria-hidden="true"
        onClick={saving ? undefined : onClose}
        className="fixed inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        ) : null}

        <label htmlFor="follow-up-note" className={`mt-4 ${LABEL}`}>
          Note
        </label>
        <textarea
          id="follow-up-note"
          ref={textareaRef}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={saving}
          rows={4}
          maxLength={2000}
          dir="auto"
          className={`${FIELD} resize-none`}
        />

        {error ? <p className={`mt-3 ${ALERT_ERROR}`}>{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={BUTTON_PRIMARY}>
            {saving ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              saveLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
