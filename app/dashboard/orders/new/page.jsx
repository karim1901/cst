import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import CreateOrder from "@/app/_components/orders/CreateOrder";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("orderForm.pageTitle");
export const dynamic = "force-dynamic";

export default async function AddOrderPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT && user.role !== USER_ROLES.EMPLOYEE) {
    redirect("/dashboard");
  }

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        {/* Back-link + heading render inside CreateOrder (a client
            component) so they follow the active locale. */}
        <CreateOrder />
      </div>
    </div>
  );
}
