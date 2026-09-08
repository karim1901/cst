/**
 * Shared form building blocks — Tailwind class strings and two tiny
 * presentational components pulled out of the individual forms
 * (AddEmployeeForm, EditEmployeeForm, SettingsForm, ...) so input/label/
 * button styling and field-error rendering can't drift between them. Plain
 * string constants + small components, not a component library — matches
 * how the rest of this codebase already styles things (inline Tailwind
 * utilities), just with one shared source instead of copy-pasted per form.
 */

export const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

export const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export const SECTION_TITLE = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
export const SECTION_HINT = "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400";

export const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200";

export const BUTTON_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800";

export const BUTTON_DANGER =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60";

export const CARD =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

export const ALERT_ERROR =
  "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300";

export const ALERT_SUCCESS =
  "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300";

export function FieldError({ errors }) {
  if (!errors || errors.length === 0) return null;
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[0]}</p>;
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
