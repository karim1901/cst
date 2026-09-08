import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import SettingsForm from "@/app/_components/SettingsForm";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Settings
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your profile and password.
          </p>
        </header>

        <SettingsForm user={user} />
      </div>
    </div>
  );
}
