import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import SettingsForm from "@/app/_components/SettingsForm";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.settings");
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        {/* Heading renders inside SettingsForm (a client component) so it
            follows the active locale. */}
        <SettingsForm user={user} />
      </div>
    </div>
  );
}
