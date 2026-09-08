import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import FollowUpList from "@/app/_components/track/FollowUpList";

export const metadata = { title: "Follow-up" };
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
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Follow-up
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Orders you&rsquo;ve chosen to follow up on later.
          </p>
        </header>

        <FollowUpList />
      </div>
    </div>
  );
}
