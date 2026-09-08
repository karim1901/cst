/**
 * Small pieces shared between the Ozon Express and Quick Livraison order
 * forms — kept local to app/_components/orders/ rather than touching the
 * (very similar) constants already duplicated in LoginForm/RegisterForm/
 * AddEmployeeForm/ShippingCompaniesManager, so this feature stays isolated
 * from unrelated ones.
 */

export const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

export const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function ErrorBanner({ children }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
    >
      {children}
    </p>
  );
}

export function SuccessBanner({ children }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      {children}
    </p>
  );
}
