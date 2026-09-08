import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { listEmployeesForMerchant, formatCommission } from "@/lib/employees";
import { USER_ROLES } from "@/models/User";
import SwitchToEmployeeButton from "@/app/_components/SwitchToEmployeeButton";

export const metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

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

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Employees
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              People who work under your account.
            </p>
          </div>
          <Link
            href="/dashboard/employees/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Add Employee
          </Link>
        </header>

        {justCreated || justUpdated ? (
          <p
            role="status"
            className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {justCreated ? "Employee created successfully." : "Employee updated successfully."}
          </p>
        ) : null}

        {employees.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {employees.map((employee) => (
              <li
                key={employee.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {employee.name}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      @{employee.username}
                    </p>
                  </div>
                  <StatusBadge active={employee.isActive} />
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                  <Row label="Phone" value={employee.phone ?? "—"} />
                  <Row label="Created" value={dateFormatter.format(new Date(employee.createdAt))} />
                  <Row
                    label="Commission"
                    value={formatCommission(employee.commission)}
                    full
                  />
                  {employee.hasQuickLivraisonApiKey ? (
                    <Row label="Quick Livraison" value="API key configured" full />
                  ) : null}
                </dl>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <Link
                    href={`/dashboard/employees/${employee.id}/edit`}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </Link>
                  {employee.isActive ? (
                    <SwitchToEmployeeButton employeeId={employee.id} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, full }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-zinc-400"}`}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        No employees yet
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Add your first employee to give them their own login and a
        commission plan.
      </p>
      <Link
        href="/dashboard/employees/new"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        Add Employee
      </Link>
    </div>
  );
}
