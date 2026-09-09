import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import FinancePageClient from "@/app/_components/finance/FinancePageClient";

export const metadata = { title: "Advertising & Profit" };
export const dynamic = "force-dynamic";

/**
 * Finance ("Advertising & Profit") — merchant-only, same ownership rule as
 * Commission/Returns/Follow-up: this is business-level financial
 * reporting, not something an employee manages. See
 * lib/finance/calculate.js for the centralized calculation every number on
 * this page comes from.
 */
export default async function FinancePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <FinancePageClient />
      </div>
    </div>
  );
}
