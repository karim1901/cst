import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { listEmployeesForMerchant, formatCommission } from "@/lib/employees";
import { USER_ROLES } from "@/models/User";
import EmployeesPageClient from "@/app/_components/employees/EmployeesPageClient";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.employees");
export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  // Authorization: employees and super admins never reach this page, even by URL.
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  const employees = await listEmployeesForMerchant(user.id);
  const params = await searchParams;
  const justCreated = params?.created === "1";
  const justUpdated = params?.updated === "1";

  // Pre-format the commission plan string server-side (a plain lib helper)
  // and hand the client component plain data — it does the labels.
  const employeesForClient = employees.map((employee) => ({
    ...employee,
    commissionText: formatCommission(employee.commission),
  }));

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <EmployeesPageClient
          employees={employeesForClient}
          justCreated={justCreated}
          justUpdated={justUpdated}
        />
      </div>
    </div>
  );
}
