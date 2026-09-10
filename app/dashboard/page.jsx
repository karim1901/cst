import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import DashboardHeader from "@/app/_components/dashboard/DashboardHeader";
import DashboardStats from "@/app/_components/dashboard/DashboardStats";
import DashboardQuickLinks from "@/app/_components/dashboard/DashboardQuickLinks";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.dashboard");
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // Server-side gate — independent of the layout above and the proxy.
  if (!user) {
    redirect("/login");
  }

  const isOrderCreator = user.role === USER_ROLES.MERCHANT || user.role === USER_ROLES.EMPLOYEE;

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <DashboardHeader name={user.name} isActive={user.isActive} />

        {/* Provider + month statistics — see DashboardStats.jsx's own
            comment: Ozon Express and Quick Livraison are always fetched
            and shown separately, never combined into one number. */}
        {isOrderCreator ? <DashboardStats /> : null}

        <DashboardQuickLinks role={user.role} />
      </div>
    </div>
  );
}
