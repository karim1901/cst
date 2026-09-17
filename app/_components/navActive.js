/**
 * Whether one Sidebar/MobileBottomNav item is the CURRENT route's active
 * item — the ONE shared rule both app/_components/SidebarNav.jsx's
 * `NavLinks` (desktop sidebar + mobile drawer) and
 * app/_components/MobileBottomNav.jsx use, so route-matching can never
 * drift apart between the three navigation surfaces, or have this exact
 * bug reappear in only one of them later.
 *
 * ROOT CAUSE this fixes: every item matched on an EXACT pathname match OR a
 * nested sub-route (`pathname` starts with `item.href + "/"`) — correct for
 * an item like Orders (`/dashboard/orders`), so a real sub-page (e.g.
 * `/dashboard/orders/new`) keeps its parent tab highlighted. Dashboard
 * (`/dashboard`) is the ONE structural exception: its href is a path-prefix
 * ANCESTOR of literally every other nav item's href (`/dashboard/orders`,
 * `/dashboard/finance`, ...), so that same prefix rule made Dashboard
 * incorrectly show as active on every single OTHER page too — verified
 * live: opening /dashboard/orders rendered BOTH "Dashboard" and "Orders"
 * with the active style and `aria-current="page"` simultaneously. Dashboard
 * has no real sub-pages of its own, so `item.exact: true` (see
 * SidebarNav.jsx's `navItemsFor`) opts it out of the prefix rule entirely —
 * active on an exact match only, exactly like a leaf route should behave.
 *
 * @param {string} pathname current `usePathname()` value
 * @param {{href:string, exact?:boolean}} item
 * @returns {boolean}
 */
export function isNavItemActive(pathname, item) {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  return pathname.startsWith(`${item.href}/`);
}
