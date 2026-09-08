import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { listShippingCompaniesForMerchant } from "@/lib/shipping-companies";
import ShippingCompaniesManager from "@/app/_components/ShippingCompaniesManager";

export const metadata = { title: "Shipping Companies" };
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
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Shipping Companies
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Your credentials for each provider, used when the application
            sends your orders to them.
          </p>
        </header>

        <ShippingCompaniesManager initialCompanies={companies} />
      </div>
    </div>
  );
}
