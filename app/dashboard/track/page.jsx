import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import FollowUpList from "@/app/_components/track/FollowUpList";
import { localizedTitle } from "@/lib/i18n/metadata";

export const generateMetadata = localizedTitle("nav.followUp");
export const dynamic = "force-dynamic";

/**
 * Follow-up — merchant-only, same rule enforced server-side by every
 * app/api/order-followups/* route (see their own comments). This
 * page-level gate is defense in depth, not the only check.
 */
export default async function TrackPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== USER_ROLES.MERCHANT) {
    redirect("/dashboard");
  }

  return (
    <div className="px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header renders inside FollowUpList (a client component) so it
            follows the active locale. */}
        <FollowUpList />
      </div>
    </div>
  );
}
