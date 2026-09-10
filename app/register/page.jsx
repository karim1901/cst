import Link from "next/link";
import { redirect } from "next/navigation";

import AuthShell from "@/app/_components/AuthShell";
import RegisterForm from "@/app/_components/RegisterForm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { localizedTitle } from "@/lib/i18n/metadata";
import { getServerT } from "@/lib/i18n/server";

export const generateMetadata = localizedTitle("auth.signUpTitle");
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  const t = await getServerT();

  return (
    <AuthShell
      badge={t("auth.merchantsOnly")}
      title={t("auth.signUpTitle")}
      subtitle={t("auth.signUpSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
          >
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
