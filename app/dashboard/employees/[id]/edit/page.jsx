import { redirect, notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { toEmployeeSummary } from "@/lib/employees";
import EditEmployeeForm from "@/app/_components/EditEmployeeForm";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("employees.editTitle");
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
        {/* Back-link + heading render inside EditEmployeeForm (a client
            component) so they follow the active locale. */}
        <EditEmployeeForm employee={employee} />
      </div>
    </div>
  );
}
