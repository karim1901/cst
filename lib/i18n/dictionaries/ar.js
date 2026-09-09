/**
 * Arabic (Modern Standard Arabic) dictionary — same key shape as
 * lib/i18n/dictionaries/en.js by construction (see lib/i18n/index.js#t,
 * which falls back to English for any key not yet present here).
 *
 * STRICT RULE (repeatedly audited): this file translates ONLY static UI
 * chrome. It must NEVER be the source of a translated/transliterated
 * business value. Two concrete consequences:
 *
 *  1. `providers.*` values are IDENTICAL to en.js — "Ozon Express" and
 *     "Quick Livraison" are proper company names, never translated or
 *     transliterated into Arabic script, in either language. The 3 call
 *     sites that look these up dynamically (ProviderTabs.jsx,
 *     ReturnsList.jsx, FollowUpList.jsx — all `t(`providers.${provider}`)`
 *     against this FIXED, server-defined enum, never raw user/business
 *     text) are therefore safe by construction: whichever locale is
 *     active, the displayed provider name is always the real one.
 *  2. "Tous"/"Livré"/"Progress"/"Retour" — this app's own established
 *     status vocabulary — are NOT keys in this file AT ALL (not here, not
 *     in en.js) — see lib/orders/status-groups.js#STATUS_FILTER_LABELS,
 *     the one place they are defined, imported directly by every
 *     component that displays them (Dashboard, Orders' StatusFilter,
 *     Returns' section tabs, Finance). Keeping them entirely OUT of the
 *     i18n system — rather than merely setting identical en/ar values — is
 *     what makes it structurally impossible for a future dictionary edit
 *     to ever translate them by accident.
 *
 * "Orders" is deliberately "طلبيات" (colloquial, the word actually used in
 * this business), never the formal "الطلبات" — see `common.orders`/
 * `nav.orders` and every other key that mentions orders below.
 */
const ar = {
  common: {
    signOut: "تسجيل الخروج",
    signingOut: "جارٍ تسجيل الخروج…",
    loading: "جارٍ التحميل…",
    error: "حدث خطأ ما.",
    save: "حفظ",
    cancel: "إلغاء",
    close: "إغلاق",
    edit: "تعديل",
    delete: "حذف",
    remove: "إزالة",
    confirm: "تأكيد",
    active: "نشط",
    inactive: "غير نشط",
    all: "الكل",
    allMonths: "كل الأشهر",
    month: "الشهر",
    theme: "المظهر",
    light: "فاتح",
    dark: "داكن",
    language: "اللغة",
    english: "الإنجليزية",
    arabic: "العربية",
    previous: "→ السابق",
    next: "التالي ←",
    page: "صفحة",
    of: "من",
    orders: "طلبيات",
    order: "طلبية",
    total: "الإجمالي",
    notifications: "الإشعارات",
    noNotifications: "لا توجد إشعارات حتى الآن.",
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    roleSuperAdmin: "مشرف عام",
    roleMerchant: "تاجر",
    roleEmployee: "موظف",
  },
  // Company/provider names — NEVER translated or transliterated (see
  // module comment above). Identical to en.js on purpose.
  providers: {
    ozon_express: "Ozon Express",
    quick_livraison: "Quick Livraison",
    shippingCompany: "شركة الشحن",
  },
  nav: {
    dashboard: "لوحة التحكم",
    orders: "طلبيات",
    commission: "العمولة",
    followUp: "المتابعة",
    returns: "المرتجعات",
    employees: "الموظفون",
    shippingCompanies: "شركات الشحن",
    settings: "الإعدادات",
    finance: "الإعلانات والأرباح",
  },
  dashboard: {
    manageOrders: "← إدارة الطلبيات",
    manageEmployees: "← إدارة الموظفين",
    manageShippingCompanies: "← إدارة شركات الشحن",
    totalOrders: "إجمالي الطلبيات",
    noData: "لا توجد بيانات بعد",
    ordersSuffix: "إجمالي الطلبيات",
    orderSuffix: "إجمالي الطلبية",
  },
  // ملاحظة: "Tous"/"Livré"/"Progress"/"Retour" غير موجودة هنا عمدًا — انظر
  // lib/orders/status-groups.js#STATUS_FILTER_LABELS، المصدر الوحيد لها،
  // تُستورَد مباشرة ولا تمرّ عبر نظام الترجمة إطلاقًا.
  returns: {
    title: "المرتجعات",
    subtitle:
      "جميع طلبياتك، وما تم تسليمه منها، وما استلمته فعليًا من الطلبيات الملغاة/المرفوضة/المرتجعة.",
    sectionAll: "كل الطلبيات",
    syncNow: "مزامنة الآن",
    syncing: "جارٍ المزامنة…",
    emptyAll: "لا توجد طلبيات",
    emptyDelivered: "لا توجد طلبيات مسلَّمة",
    emptyReturns: "لا توجد مرتجعات",
    validated: "تم التأكيد",
    pending: "قيد الانتظار",
    validateReturn: "تأكيد الاستلام",
    validating: "جارٍ التأكيد…",
    markAsPending: "إعادة إلى قيد الانتظار",
    openOrder: "فتح الطلبية",
    confirmValidate: "هل تؤكد استلامك الفعلي لهذا الطرد المرتجع؟",
    confirmUnvalidate: "إعادة هذا المرتجع إلى حالة قيد الانتظار؟",
  },
  followUp: {
    title: "المتابعة",
    empty: "لا توجد طلبيات في قائمة المتابعة",
    editTitle: "تعديل المتابعة",
    saveChanges: "حفظ التغييرات",
    openOrder: "فتح الطلبية",
    editFollowUp: "تعديل المتابعة",
    removeFollowUp: "إزالة من المتابعة",
    confirmRemove: "إزالة هذه الطلبية من قائمة المتابعة؟",
    addToFollowUp: "إضافة إلى المتابعة",
    addedToFollowUp: "أُضيف إلى المتابعة",
  },
  auth: {
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    signingIn: "جارٍ تسجيل الدخول…",
  },
  finance: {
    title: "الإعلانات والأرباح",
    daily: "يومي",
    monthly: "شهري",
    advertising: "الإعلانات",
    adSpend: "مصروف الإعلانات",
    adCostPerOrder: "تكلفة الإعلان لكل طلبية",
    adCostPerDelivered: "تكلفة الإعلان لكل طلبية مسلَّمة",
    productCosts: "تكلفة المنتجات",
    shippingCosts: "تكلفة الشحن",
    otherExpenses: "مصاريف أخرى",
    totalCosts: "إجمالي التكاليف",
    revenue: "الإيرادات",
    profit: "الربح",
    netProfit: "صافي الربح",
    addExpense: "إضافة مصروف",
    date: "التاريخ",
    amount: "المبلغ",
    title_: "العنوان",
    description: "الوصف",
    category: "الفئة",
    provider: "المزوّد",
    products: "المنتجات",
    costPerUnit: "التكلفة لكل وحدة",
    costNotConfigured: "التكلفة غير مُعدَّة",
    configureNow: "إعداد الآن",
    profitPerDelivered: "الربح لكل طلبية مسلَّمة",
    averageOrderValue: "متوسط قيمة الطلبية",
    deliveryRate: "معدّل التسليم",
    returnRate: "معدّل الإرجاع",
    noExpensesYet: "لا توجد مصاريف بعد",
    noProductsYet: "لم تُكتشف أي منتجات بعد",
  },
};

export default ar;
