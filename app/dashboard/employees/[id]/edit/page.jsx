import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { toEmployeeSummary } from "@/lib/employees";
import EditEmployeeForm from "@/app/_components/EditEmployeeForm";

export const metadata = { title: "Edit Employee" };
export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  const { id } = await params;
  await connectToDatabase();

  // Same ownership rule as everywhere else — an id that isn't a real,
  // owned employee 404s exactly like one that doesn't exist at all.
  const isValidId = typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
  const employeeDoc = isValidId
    ? await User.findOne({ _id: id, merchantId: user.id, role: USER_ROLES.EMPLOYEE }).select(
        "+ozonTrackingCounter"
      )
    : null;

  if (!employeeDoc) {
    notFound();
  }

  const employee = {
    ...toEmployeeSummary(employeeDoc),
    ozonTrackingCounter: employeeDoc.ozonTrackingCounter ?? null,
  };

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <Link
          href="/dashboard/employees"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
        >
          ← Employees
        </Link>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Edit {employee.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          @{employee.username}
        </p>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <EditEmployeeForm employee={employee} />
        </div>
      </div>
    </div>
  );
}
