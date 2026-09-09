/**
 * English dictionary — the source-language reference every other locale's
 * dictionary must have the exact same key shape as (see
 * lib/i18n/index.js#t, which falls back to this dictionary for any key
 * missing from a non-English one, so a partial translation degrades to
 * English text instead of a broken/blank UI).
 *
 * Organized by feature namespace (nav, dashboard, orders, ...) — the same
 * grouping the app's own folder structure already uses — rather than one
 * flat list, so a translator (or future contributor) can find/extend one
 * feature's strings without scanning the whole file.
 */
const en = {
  common: {
    signOut: "Sign out",
    signingOut: "Signing out…",
    loading: "Loading…",
    error: "Something went wrong.",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    edit: "Edit",
    delete: "Delete",
    remove: "Remove",
    confirm: "Confirm",
    active: "Active",
    inactive: "Inactive",
    all: "All",
    allMonths: "All Months",
    month: "Month",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    language: "Language",
    english: "English",
    arabic: "Arabic",
    previous: "← Previous",
    next: "Next →",
    page: "Page",
    of: "of",
    orders: "orders",
    order: "order",
    total: "Total",
    notifications: "Notifications",
    noNotifications: "No notifications yet.",
    openMenu: "Toggle menu",
    closeMenu: "Close menu",
    roleSuperAdmin: "Super Admin",
    roleMerchant: "Merchant",
    roleEmployee: "Employee",
  },
  providers: {
    ozon_express: "Ozon Express",
    quick_livraison: "Quick Livraison",
    shippingCompany: "Shipping company",
  },
  nav: {
    dashboard: "Dashboard",
    orders: "Orders",
    commission: "Commission",
    followUp: "Follow-up",
    returns: "Returns",
    employees: "Employees",
    shippingCompanies: "Shipping Companies",
    settings: "Settings",
  },
  dashboard: {
    manageOrders: "Manage orders →",
    manageEmployees: "Manage employees →",
    manageShippingCompanies: "Manage shipping companies →",
    delivered: "Livré",
    returned: "Retour",
    progress: "Progress",
    totalOrders: "Total Orders",
    noData: "No data yet",
    ordersSuffix: "total orders",
    orderSuffix: "total order",
  },
  returns: {
    title: "Returns",
    subtitle:
      "All your orders, which ones have been delivered, and which cancelled/refused/returned ones you have physically received back.",
    sectionAll: "All Orders",
    sectionDelivered: "Delivered",
    sectionReturns: "Returns",
    syncNow: "Sync now",
    syncing: "Syncing…",
    emptyAll: "No orders found",
    emptyDelivered: "No delivered orders found",
    emptyReturns: "No returns found",
    validated: "Validated",
    pending: "Pending",
    validateReturn: "Validate Return",
    validating: "Validating…",
    markAsPending: "Mark as Pending",
    openOrder: "Open Order",
    confirmValidate: "Confirm you have physically received this returned package?",
    confirmUnvalidate: "Mark this return as pending again?",
  },
  followUp: {
    title: "Follow-up",
    empty: "No orders in Follow-up",
    editTitle: "Edit Follow-up",
    saveChanges: "Save Changes",
    openOrder: "Open Order",
    editFollowUp: "Edit Follow-up",
    removeFollowUp: "Remove from Follow-up",
    confirmRemove: "Remove this order from Follow-up?",
    addToFollowUp: "Add to Follow-up",
    addedToFollowUp: "Added to Follow-up",
  },
  auth: {
    signIn: "Sign in",
    signUp: "Sign up",
    signingIn: "Signing in…",
  },
};

export default en;
