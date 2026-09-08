import Link from "next/link";
import { redirect } from "next/navigation";

import AuthShell from "@/app/_components/AuthShell";
import RegisterForm from "@/app/_components/RegisterForm";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata = { title: "Create a merchant account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  return (
    <AuthShell
      badge="Merchants only"
      title="Create a merchant account"
      subtitle="Registration is for business owners. Employees are added by their merchant; super admins are provisioned separately."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
