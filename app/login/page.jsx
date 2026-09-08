import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import AuthShell from "@/app/_components/AuthShell";
import LoginForm from "@/app/_components/LoginForm";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Authenticated users have no reason to be here.
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="One sign-in for super admins, merchants, and employees — your role is detected automatically."
      footer={
        <>
          New merchant?{" "}
          <Link
            href="/register"
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
          >
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

function FormFallback() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-10 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
    </div>
  );
}
