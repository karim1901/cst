/**
 * Client-safe constants for the Returns feature (app/dashboard/returns) —
 * kept independent of any Mongoose model, same reason as
 * lib/shipping/providers.js and lib/auth/roles.js: importing a model drags
 * mongoose/mongodb into the browser bundle. models/Order.js imports the
 * validation-status values from here, not the other way around.
 */

/**
 * The merchant's own internal "did I physically get this package back?"
 * state — entirely separate from the shipping provider's own live status
 * (models/Order.js's `lastKnownStatus`). Provider status sync
 * (lib/returns/sync.js, lib/commission/sync-status.js) NEVER writes this —
 * only the validate/unvalidate actions do (app/api/returns/[id]/validate
 * and .../unvalidate). New/existing orders always default to "pending";
 * nothing is ever auto-marked "validated".
 */
export const RETURN_VALIDATION_STATUSES = Object.freeze({
  PENDING: "pending",
  VALIDATED: "validated",
});

export const RETURN_VALIDATION_STATUS_VALUES = Object.freeze(
  Object.values(RETURN_VALIDATION_STATUSES)
);

/** The Returns page's "All / Pending / Validated" filter — "all" is the
 * no-op 3rd option, same convention as ORDER_STATUS_FILTERS.ALL
 * (lib/orders/status-groups.js). */
export const RETURN_VALIDATION_FILTERS = Object.freeze({
  ALL: "all",
  PENDING: RETURN_VALIDATION_STATUSES.PENDING,
  VALIDATED: RETURN_VALIDATION_STATUSES.VALIDATED,
});

export const RETURN_VALIDATION_FILTER_VALUES = Object.freeze(
  Object.values(RETURN_VALIDATION_FILTERS)
);

export const VALIDATION_LABELS = Object.freeze({
  all: "All",
  pending: "Pending",
  validated: "Validated",
});

/**
 * The Returns page's own shipping-status filter — narrower than
 * lib/orders/status-groups.js's ORDER_STATUS_FILTERS (which also covers
 * delivered/in-progress orders, irrelevant on this page): only the 3
 * reasons this page exists for. Maps to
 * lib/orders/status-groups.js#classifyReturnReason, the one centralized
 * place that turns a provider's raw status string (Ozon's French tokens or
 * Quick's English ones) into one of these.
 */
export const SHIPPING_STATUS_FILTERS = Object.freeze({
  ALL: "all",
  CANCELLED: "cancelled",
  REFUSED: "refused",
  RETURNED: "returned",
});

export const SHIPPING_STATUS_FILTER_VALUES = Object.freeze(
  Object.values(SHIPPING_STATUS_FILTERS)
);

export const SHIPPING_STATUS_LABELS = Object.freeze({
  all: "All",
  cancelled: "Cancelled",
  refused: "Refused",
  returned: "Returned",
});

/**
 * The 3 top-level sections of the order-lifecycle page (app/dashboard/returns):
 *  - "all"      — every order belonging to the merchant, any status.
 *  - "delivered" — orders whose `deliveredAt` is set (the same authoritative
 *    "was this ever delivered" fact every other part of this app already
 *    treats as final — see models/Order.js's own comment on that field).
 *  - "returns"  — the original Returns feature, entirely unchanged (see
 *    SHIPPING_STATUS_FILTERS/RETURN_VALIDATION_FILTERS above).
 * All 3 are just different filtered reads of the SAME `Order` collection —
 * no separate dataset, no manual "move order" action anywhere. "all" is the
 * page's default section.
 */
export const ORDER_LIFECYCLE_SECTIONS = Object.freeze({
  ALL: "all",
  DELIVERED: "delivered",
  RETURNS: "returns",
});

export const ORDER_LIFECYCLE_SECTION_VALUES = Object.freeze(
  Object.values(ORDER_LIFECYCLE_SECTIONS)
);

export const ORDER_LIFECYCLE_SECTION_LABELS = Object.freeze({
  all: "All",
  delivered: "Delivered",
  returns: "Returns",
});

/**
 * The Delivered section's own "Delivery Date" filter — always matched
 * against `Order.deliveredAt` (the REAL delivery moment), never `createdAt`
 * — see lib/returns/delivery-date.js, which resolves these into an actual
 * `[start, end)` range in the server's local timezone (never UTC-shifted).
 */
export const DELIVERY_DATE_FILTERS = Object.freeze({
  ALL: "all",
  TODAY: "today",
  YESTERDAY: "yesterday",
  LAST_7_DAYS: "last7",
  CUSTOM_DATE: "customDate",
  CUSTOM_RANGE: "customRange",
});

export const DELIVERY_DATE_FILTER_VALUES = Object.freeze(
  Object.values(DELIVERY_DATE_FILTERS)
);

export const DELIVERY_DATE_FILTER_LABELS = Object.freeze({
  all: "All Dates",
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 Days",
  customDate: "Custom Date",
  customRange: "Custom Range",
});
