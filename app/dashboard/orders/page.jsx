import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listEmployeesForMerchant } from "@/lib/employees";
import OrdersPageClient from "@/app/_components/orders/OrdersPageClient";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  // Both merchants and their employees create orders; super admins don't.
  if (user.role !== USER_ROLES.MERCHANT && user.role !== USER_ROLES.EMPLOYEE) {
    redirect("/dashboard");
  }

  const isMerchant = user.role === USER_ROLES.MERCHANT;
  // Only fetched for merchants — the employee filter is merchant-only (an
  // employee has no employees of their own to pick from).
  const employees = isMerchant ? await listEmployeesForMerchant(user.id) : [];

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Orders
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {isMerchant
                ? "Browse your own orders, one employee's, or all of them — by shipping company and month."
                : "Your orders, live from the shipping company you select."}
            </p>
          </div>
          <Link
            href="/dashboard/orders/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Add Order
          </Link>
        </header>

        <OrdersPageClient isMerchant={isMerchant} employees={employees} />
      </div>
    </div>
  );
}
