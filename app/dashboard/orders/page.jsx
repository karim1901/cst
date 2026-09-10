import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listEmployeesForMerchant } from "@/lib/employees";
import OrdersPageClient from "@/app/_components/orders/OrdersPageClient";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.orders");
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
        {/* Header lives INSIDE the client component now so it renders in
            the active locale (it's an async server component here — it
            can't call useLocale()). This was the root cause of the
            "sidebar Arabic, page English" bug. OrdersPageClient also reads
            useSearchParams() (Follow-up's "Open Order" deep link), which
            Next.js requires a Suspense boundary for even on a fully
            dynamic page. */}
        <Suspense fallback={null}>
          <OrdersPageClient isMerchant={isMerchant} employees={employees} />
        </Suspense>
      </div>
    </div>
  );
}
