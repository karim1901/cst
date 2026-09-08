import Link from "next/link";

/**
 * Presentational wrapper for the login / register screens.
 * No client-side behaviour, so it stays a server component.
 */
export default function AuthShell({ title, subtitle, badge, children, footer }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 px-4 py-12 dark:from-black dark:to-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-900 text-xs font-bold text-white dark:bg-white dark:text-black">
              CST
            </span>
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-6">
            {badge ? (
              <span className="mb-3 inline-block rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {badge}
              </span>
            ) : null}
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </p>
            ) : null}
          </div>

          {children}
        </div>

        {footer ? (
          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {footer}
          </p>
        ) : null}
      </div>
    </main>
  );
}
