import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import CommissionTable from "@/app/_components/commission/CommissionTable";

export const metadata = { title: "Commission" };
export const dynamic = "force-dynamic";

export default async function CommissionPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  // Authorization: super admins never reach this page, even by URL —
  // merchants see every one of their own employees (unchanged), employees
  // now see this same page too, but GET /api/commission itself is what
  // actually scopes an employee down to only their own row (see that
  // route's comment) — this page-level check only decides who gets in the
  // door at all, same boundary style as /dashboard/employees.
  if (user.role !== USER_ROLES.MERCHANT && user.role !== USER_ROLES.EMPLOYEE) {
    redirect("/dashboard");
  }

  const isEmployee = user.role === USER_ROLES.EMPLOYEE;

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Commission
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {isEmployee
              ? "Your monthly commission, calculated from your delivered orders."
              : "Monthly commission per employee, calculated from delivered orders."}
          </p>
        </header>

        <CommissionTable
          emptyStateMessage={
            isEmployee ? "No commission data yet for the selected month." : "No employees yet."
          }
        />
      </div>
    </div>
  );
}
