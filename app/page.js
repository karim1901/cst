import Link from "next/link";

export default function Home() {
  const stack = [
    "Next.js (App Router)",
    "Tailwind CSS",
    "MongoDB Atlas",
    "Mongoose",
    "PWA / Service Worker",
  ];

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Project starter
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Everything below is wired up and ready to build on.
        </p>

        <ul className="mt-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {stack.map((item) => (
            <li
              key={item}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Register as merchant
          </Link>
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          Check the database wiring at{" "}
          <a
            href="/api/health"
            className="font-medium underline underline-offset-2"
          >
            /api/health
          </a>
          .
        </p>
      </div>
    </main>
  );
}
