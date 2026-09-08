import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { connectToDatabase } from "@/lib/mongodb";
import { computeOrderDeliveryStats } from "@/lib/orders/dashboard-stats";
import StatsCards from "@/app/_components/dashboard/StatsCards";
import DashboardHeader from "@/app/_components/dashboard/DashboardHeader";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // Server-side gate — independent of the layout above and the proxy.
  if (!user) {
    redirect("/login");
  }

  const isOrderCreator = user.role === USER_ROLES.MERCHANT || user.role === USER_ROLES.EMPLOYEE;

  let stats = null;
  if (isOrderCreator) {
    await connectToDatabase();
    stats = await computeOrderDeliveryStats({
      // Merchants see every order under their own account, including their
      // employees' — an employee sees only their own. Same scoping rule as
      // lib/commission/report.js.
      merchantId: user.role === USER_ROLES.EMPLOYEE ? user.merchantId : user.id,
      employeeId: user.role === USER_ROLES.EMPLOYEE ? user.id : null,
    });
  }

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <DashboardHeader name={user.name} isActive={user.isActive} />

        {stats ? <StatsCards stats={stats} /> : null}

        {user.role === "merchant" || user.role === "employee" ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
            >
              Manage orders →
            </Link>
            {user.role === "merchant" ? (
              <>
                <Link
                  href="/dashboard/employees"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
                >
                  Manage employees →
                </Link>
                <Link
                  href="/dashboard/shipping-companies"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
                >
                  Manage shipping companies →
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
