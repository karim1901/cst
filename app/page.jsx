import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * "/" is never a real page in this app — it only ever redirects, so a
 * visitor can never land on implementation/starter content. `proxy.js`
 * already redirects "/" at the edge (see its own comment) before this
 * would normally even render; this is the authoritative, defense-in-depth
 * fallback every other page already has (same `getCurrentUser()` call, no
 * second auth mechanism) for any request that reaches here regardless —
 * e.g. if the proxy's matcher is ever changed and stops covering "/".
 *
 * Every role lands on the same `/dashboard` — it is already role-aware
 * internally (see app/dashboard/page.jsx); there is no separate merchant/
 * employee/super-admin route to redirect to instead.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
