import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listEmployeesForMerchant } from "@/lib/employees";
import ReturnsList from "@/app/_components/returns/ReturnsList";

export const metadata = { title: "Returns" };
export const dynamic = "force-dynamic";

/**
 * Order-lifecycle page — All / Delivered / Returns, 3 filtered views of the
 * same `Order` collection (see app/_components/returns/ReturnsList.jsx's
 * module comment). Merchant-only, same rule enforced server-side by every
 * app/api/returns/* route (see their own comments). This page-level gate is
 * defense in depth, not the only check. Entirely separate from Follow-up
 * (app/dashboard/track).
 */
export default async function ReturnsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  // Only used by the Delivered section's Employee filter (see
  // app/_components/returns/DeliveredFilters.jsx) — loaded server-side, same
  // as app/dashboard/orders/page.jsx does for its own employee filter.
  const employees = await listEmployeesForMerchant(user.id);

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Returns
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            All your orders, which ones have been delivered, and which cancelled/refused/returned
            ones you have physically received back.
          </p>
        </header>

        <ReturnsList employees={employees} />
      </div>
    </div>
  );
}
