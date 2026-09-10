import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import AddEmployeeForm from "@/app/_components/AddEmployeeForm";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("employeeForm.newTitle");
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
        {/* Back-link + heading render inside AddEmployeeForm (a client
            component) so they follow the active locale. */}
        <AddEmployeeForm />
      </div>
    </div>
  );
}
