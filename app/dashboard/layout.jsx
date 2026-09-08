import { redirect } from "next/navigation";

import SidebarNav from "@/app/_components/SidebarNav";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * Shared chrome for everything under /dashboard: the authentication gate
 * (independent of the Edge proxy check) plus the sidebar. Per-route
 * authorization (e.g. "merchant only") is enforced again in the nested
 * pages themselves, since a role that may view /dashboard is not
 * necessarily allowed on every page beneath it.
 */
export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <SidebarNav user={user}>{children}</SidebarNav>;
}
