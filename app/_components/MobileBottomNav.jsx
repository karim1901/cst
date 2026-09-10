"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Bottom tab bar for the primary sections, mobile only — the pattern a real
 * mobile app uses for its most important destinations, rather than making
 * every page start with a trip into a drawer. `items` is the same
 * role-aware list SidebarNav already builds (`navItemsFor`); this only
 * takes the first few (the ones worth a permanent thumb-reach slot) plus a
 * "More" entry that opens the existing drawer for everything else.
 */
export default function MobileBottomNav({ items, onOpenMore }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const primary = items.slice(0, 3);
  const hasMore = items.length > primary.length;
  const columns = hasMore ? primary.length + 1 : primary.length;

  return (
    <nav
      aria-label={t("common.primaryNav")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>

        {primary.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              <span className={active ? "opacity-100" : "opacity-70"} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
        {hasMore ? (
          <button
            type="button"
            onClick={onOpenMore}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-4.5 w-4.5 opacity-70"
            >
              <circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
            </svg>
            {t("common.more")}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
