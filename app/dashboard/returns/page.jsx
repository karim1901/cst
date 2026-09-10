import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listEmployeesForMerchant } from "@/lib/employees";
import ReturnsList from "@/app/_components/returns/ReturnsList";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.returns");
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
        {/* Header renders inside ReturnsList (a client component) so it
            follows the active locale. */}
        <ReturnsList employees={employees} />
      </div>
    </div>
  );
}
