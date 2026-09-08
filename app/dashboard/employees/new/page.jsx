import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import AddEmployeeForm from "@/app/_components/AddEmployeeForm";

export const metadata = { title: "Add Employee" };
export const dynamic = "force-dynamic";

export default async function AddEmployeePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

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
          Add Employee
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          They will be able to sign in with the username and password you set below.
        </p>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <AddEmployeeForm />
        </div>
      </div>
    </div>
  );
}
