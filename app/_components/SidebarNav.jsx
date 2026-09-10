"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import LogoutButton from "@/app/_components/LogoutButton";
import ImpersonationBanner from "@/app/_components/ImpersonationBanner";
import MobileBottomNav from "@/app/_components/MobileBottomNav";
import ThemeToggle from "@/app/_components/theme/ThemeToggle";
import LanguageSwitcher from "@/app/_components/i18n/LanguageSwitcher";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
const ROLE_KEY = {
  super_admin: "common.roleSuperAdmin",
  merchant: "common.roleMerchant",
  employee: "common.roleEmployee",
};

// One small icon per line, no icon library — kept consistent with the
// existing hamburger icon's own style (stroke, currentColor, 1.75 weight).
const ICONS = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.3" />
      <rect x="10.5" y="3" width="6.5" height="4.5" rx="1.3" />
      <rect x="10.5" y="9" width="6.5" height="8" rx="1.3" />
      <rect x="3" y="11.5" width="6.5" height="5.5" rx="1.3" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5 10 3l6 3.5v7L10 17l-6-3.5v-7Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5 10 10l6-3.5M10 10v7" />
    </svg>
  ),
  commission: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <circle cx="10" cy="10" r="6.5" />
      <path strokeLinecap="round" d="M10 6.5v7M12.2 8.3c0-1-.9-1.8-2.2-1.8s-2.2.7-2.2 1.6c0 2.2 4.4 1 4.4 3.1 0 .9-1 1.6-2.2 1.6s-2.2-.7-2.2-1.7" />
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <circle cx="7.5" cy="6.5" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 16c.6-2.8 2.5-4.5 5-4.5s4.4 1.7 5 4.5" />
      <circle cx="14.5" cy="7" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 11.7c1.9.4 3.2 1.8 3.6 4.3" />
    </svg>
  ),
  track: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h10v14l-5-3-5 3V3Z" />
    </svg>
  ),
  returns: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5a6 6 0 1 1 1.8 4.3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5V5.5M4 9.5h4" />
    </svg>
  ),
  shipping: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 13.5V6.8L10 3l7.5 3.8v6.7L10 17l-7.5-3.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 6.8 10 10.3l7.5-3.5M10 10.3V17" />
    </svg>
  ),
  finance: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 15.5V4.5M3 15.5h14M6.5 15.5v-5M10.5 15.5V8M14.5 15.5V6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <circle cx="10" cy="10" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 3v2M10 15v2M17 10h-2M5 10H3M14.9 5.1l-1.4 1.4M6.5 13.5l-1.4 1.4M14.9 14.9l-1.4-1.4M6.5 6.5 5.1 5.1" />
    </svg>
  ),
};

// Order matters: MobileBottomNav takes the first few of these for its
// permanent tabs — put the sections worth a thumb-reach slot first.
function navItemsFor(role, t) {
  const items = [{ href: "/dashboard", label: t("nav.dashboard"), icon: ICONS.dashboard }];
  if (role === "merchant" || role === "employee") {
    items.push({ href: "/dashboard/orders", label: t("nav.orders"), icon: ICONS.orders });
    items.push({ href: "/dashboard/commission", label: t("nav.commission"), icon: ICONS.commission });
    // Follow-up — a personal manual reminder list layered on top of Orders
    // (see app/api/order-followups/route.js's module comment). Merchants
    // AND employees each get their OWN independent list; the server scopes
    // every query to the session owner. Never shown to super admins.
    items.push({ href: "/dashboard/track", label: t("nav.followUp"), icon: ICONS.track });
  }
  if (role === "merchant") {
    // Returns — internal management of cancelled/refused/returned orders,
    // deliberately separate from Follow-up (see app/_components/returns/
    // ReturnsList.jsx's module comment for why). Merchant-only for the same
    // reason Follow-up is: it's a merchant-side internal workflow, not
    // something an employee acts on directly.
    items.push({ href: "/dashboard/returns", label: t("nav.returns"), icon: ICONS.returns });
    // Finance ("Advertising & Profit") — merchant-only business financial
    // reporting, same ownership boundary as Follow-up/Returns/Commission's
    // merchant-side view (see app/dashboard/finance/page.jsx).
    items.push({ href: "/dashboard/finance", label: t("nav.finance"), icon: ICONS.finance });
    items.push({ href: "/dashboard/employees", label: t("nav.employees"), icon: ICONS.employees });
    items.push({
      href: "/dashboard/shipping-companies",
      label: t("nav.shippingCompanies"),
      icon: ICONS.shipping,
    });
  }
  // Every role gets Settings — including super_admin, who otherwise has no
  // nav items besides Dashboard.
  items.push({ href: "/dashboard/settings", label: t("nav.settings"), icon: ICONS.settings });
  return items;
}

function NavLinks({ items, pathname, onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            <span className={active ? "opacity-100" : "opacity-60"} aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function SidebarNav({ user, children }) {
  const pathname = usePathname();
  const { t, dir } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = navItemsFor(user.role, t);

  // Close automatically on navigation (Link's own onClick below covers a
  // tap on a nav item, but not e.g. the browser back/forward buttons) —
  // adjusted during render, React's recommended pattern for "reset state
  // when a prop/value changes", rather than a synchronous setState at the
  // top of an effect (flagged by the react-hooks linter as a cascading-
  // render risk) — same pattern already used by the order-list components.
  const [closedForPathname, setClosedForPathname] = useState(pathname);
  if (pathname !== closedForPathname) {
    setClosedForPathname(pathname);
    setMobileOpen(false);
  }

  // Standard drawer behavior: freeze the page underneath while open (so a
  // touch-scroll inside the drawer's own nav list can't also scroll the
  // page behind it) and let Escape close it, same as the backdrop/close
  // button.
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-black md:flex">
      {/* Desktop sidebar — normal document flow, part of the md:flex row.
          Entirely separate markup from the mobile drawer below, not just a
          responsive variant of it, so mobile-only behavior (overlay,
          backdrop, transform) can never leak into the desktop layout. */}
      <aside className="hidden shrink-0 border-r border-zinc-200 md:flex md:w-64 md:flex-col dark:border-zinc-800">
        <div className="px-5 py-5">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            CST
          </span>
        </div>
        <div className="flex-1 px-3">
          <NavLinks items={items} pathname={pathname} />
        </div>
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {user.name}
          </p>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {t(ROLE_KEY[user.role] ?? "common.roleEmployee")}
          </p>
          <div className="mb-3 flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile GLOBAL header — sticky, always rendered (not inside the
          collapsible drawer below), so the authenticated user's identity,
          Logout, theme, and language stay visible/reachable on every
          authenticated page on mobile without opening the menu. This is
          the actual fix for "name/logout disappear off the Dashboard": the
          desktop sidebar's footer (above) already persisted across every
          /dashboard/* route the whole time (this component IS the shared
          layout every nested page renders through — see
          app/dashboard/layout.jsx) — the real gap was mobile, where those
          same elements previously lived ONLY inside the collapsed-by-
          default drawer. */}
      <div className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-black/95">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-black"
            >
              {(user.name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {user.name}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle className="h-9 w-9" />
            <LanguageSwitcher className="h-9 w-9" />
            <LogoutButton compact />
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-300 text-zinc-700 active:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:active:bg-zinc-800"
            >
              <span className="sr-only">{t("common.openMenu")}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                className="h-5 w-5"
              >
                {mobileOpen ? (
                  <path strokeLinecap="round" d="M5 5l10 10M15 5 5 15" />
                ) : (
                  <path strokeLinecap="round" d="M3 5h14M3 10h14M3 15h14" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Backdrop — fixed, independent of document flow, sits above
          everything except the drawer panel itself. Tapping it closes the
          drawer. Kept mounted (not conditionally rendered) so the
          opacity/pointer-events transition can actually run instead of the
          element just appearing/disappearing instantly. */}
      <div
        aria-hidden="true"
        onClick={() => setMobileOpen(false)}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Mobile drawer — fixed positioning takes it OUT of normal document
          flow entirely, so it can never push or get pushed by page content;
          it overlays on top instead, via z-index above the backdrop.
          `h-dvh` (not `h-screen`) so it respects the real, dynamic mobile
          viewport height (browser chrome showing/hiding), matching the
          convention already used on this component's own root element.
          Width is capped (not 100%) so even this panel itself can never be
          the source of horizontal overflow. */}
      <aside
        id="mobile-nav"
        aria-label={t("common.openMenu")}
        className={`fixed inset-y-0 start-0 z-40 flex h-dvh w-72 max-w-[85vw] flex-col border-e border-zinc-200 bg-zinc-50 shadow-xl transition-transform duration-200 ease-out md:hidden dark:border-zinc-800 dark:bg-black ${
          mobileOpen ? "translate-x-0" : dir === "rtl" ? "translate-x-full" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            CST
          </span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t("common.closeMenu")}
            className="grid h-9 w-9 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100 dark:text-zinc-400 dark:active:bg-zinc-800"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <NavLinks
            items={items}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>

        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {user.name}
          </p>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {t(ROLE_KEY[user.role] ?? "common.roleEmployee")}
          </p>
          <LogoutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        {user.impersonatorId ? <ImpersonationBanner employeeName={user.name} /> : null}
        {children}
      </main>

      <MobileBottomNav items={items} onOpenMore={() => setMobileOpen(true)} />
    </div>
  );
}
