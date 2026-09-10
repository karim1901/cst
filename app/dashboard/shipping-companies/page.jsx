import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listShippingCompaniesForMerchant } from "@/lib/shipping-companies";
import ShippingCompaniesManager from "@/app/_components/ShippingCompaniesManager";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.shippingCompanies");
export const dynamic = "force-dynamic";

export default async function ShippingCompaniesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  // Authorization: owned by the merchant, same as employees — employees and
  // super admins never reach this page, even by URL.
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  const companies = await listShippingCompaniesForMerchant(user.id);

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        {/* Heading renders inside ShippingCompaniesManager (a client
            component) so it follows the active locale. */}
        <ShippingCompaniesManager initialCompanies={companies} />
      </div>
    </div>
  );
}
