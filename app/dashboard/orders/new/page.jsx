import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import CreateOrder from "@/app/_components/orders/CreateOrder";

export const metadata = { title: "Add Order" };
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
        <Link
          href="/dashboard/orders"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
        >
          ← Orders
        </Link>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Add Order
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a shipping company, then fill in the order details.
        </p>

        <div className="mt-8">
          <CreateOrder />
        </div>
      </div>
    </div>
  );
}
