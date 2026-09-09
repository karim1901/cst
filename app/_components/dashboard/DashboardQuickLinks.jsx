"use client";

import Link from "next/link";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100";

/** Dashboard's quick-navigation row — role-scoped, unchanged behavior from
 * before this file existed, just extracted out of the page so it can be a
 * client component (needed for translated labels via useLocale). */
export default function DashboardQuickLinks({ role }) {
  const { t } = useLocale();

  if (role !== "merchant" && role !== "employee") return null;

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/dashboard/orders" className={LINK_CLASS}>
        {t("dashboard.manageOrders")}
      </Link>
      {role === "merchant" ? (
        <>
          <Link href="/dashboard/employees" className={LINK_CLASS}>
            {t("dashboard.manageEmployees")}
          </Link>
          <Link href="/dashboard/shipping-companies" className={LINK_CLASS}>
            {t("dashboard.manageShippingCompanies")}
          </Link>
        </>
      ) : null}
    </div>
  );
}
