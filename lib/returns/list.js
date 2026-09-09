import { connectToDatabase } from "@/lib/mongodb";
import Order from "@/models/Order";
import { RETURN_STATUS_RAW_TOKENS, RETURN_REASON_RAW_TOKENS } from "@/lib/orders/status-groups";
import { ORDER_LIFECYCLE_SECTIONS } from "@/lib/returns/constants";

/**
 * Order-lifecycle page (app/dashboard/returns) — reads the local `Order`
 * mirror ONLY (fast, no provider call on this request; see
 * lib/returns/sync.js for the separate synchronization job). Mirrors the
 * shape/conventions of lib/order-followups.js and app/api/orders/route.js's
 * "all employees" browser (same populate-from-Order, same collation-based
 * status matching) rather than introducing a new pattern.
 *
 * `queryReturnsForMerchant` is the ORIGINAL Returns query, unchanged —
 * still the one used for the "returns" section (see `queryOrdersForSection`
 * below, which simply delegates to it for that section rather than
 * reimplementing it). `queryOrdersForSection` is the newer, general entry
 * point covering all 3 sections ("all" / "delivered" / "returns"); nothing
 * about the original Returns behavior changed.
 */

const RETURNS_SELECT =
  "employeeId provider trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt createdAt updatedAt returnValidationStatus returnValidatedAt returnValidatedBy";

/** Shape returned for one order on the Returns page. */
export function toReturnSummary(doc) {
  return {
    id: String(doc._id),
    provider: doc.provider,
    trackingNumber: doc.trackingNumber,
    employee: doc.employeeId
      ? { id: String(doc.employeeId._id ?? doc.employeeId), name: doc.employeeId.name ?? null }
      : null,
    receiver: doc.receiverName,
    phone: doc.phone,
    city: doc.city,
    address: doc.address,
    product: doc.productNature,
    price: doc.price,
    status: doc.lastKnownStatus,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    // The REAL delivery moment (never `createdAt`) — only meaningful (and
    // only rendered) for the Delivered section, but harmless to include for
    // every order; it's simply `null` for one that was never delivered.
    deliveredAt: doc.deliveredAt ?? null,
    returnValidationStatus: doc.returnValidationStatus ?? "pending",
    returnValidatedAt: doc.returnValidatedAt ?? null,
    returnValidatedBy: doc.returnValidatedBy
      ? {
          id: String(doc.returnValidatedBy._id ?? doc.returnValidatedBy),
          name: doc.returnValidatedBy.name ?? null,
        }
      : null,
  };
}

/**
 * Cancelled/refused/returned orders for one merchant, filtered/paginated
 * entirely in MongoDB — never delivered or in-progress orders (see
 * lib/orders/status-groups.js's classification, the single source of truth
 * this filter reuses rather than re-implementing).
 *
 * @param {string} merchantId
 * @param {{provider: string, shippingStatus?: string, validation?: string, page?: number, pageSize?: number}} options
 *   `provider`: REQUIRED — "ozon_express" | "quick_livraison". Ozon and
 *   Quick returns are never combined into one list (see this page's own
 *   module comment / app/_components/returns/ReturnsList.jsx's
 *   ProviderTabs).
 *   `shippingStatus`: "all" | "cancelled" | "refused" | "returned"
 *   `validation`: "all" | "pending" | "validated"
 */
export async function queryReturnsForMerchant(merchantId, options = {}) {
  const { provider, shippingStatus = "all", validation = "all", page = 1, pageSize = 20 } = options;

  await connectToDatabase();

  const filter = {
    merchantId,
    provider,
    // A return status never coincides with a delivered order in practice
    // (their `lastKnownStatus` values are disjoint sets), but this mirrors
    // app/api/orders/route.js's own defensive convention exactly, so the
    // invariant is explicit here too, not just implied.
    deliveredAt: null,
    lastKnownStatus: {
      $in:
        shippingStatus !== "all" && RETURN_REASON_RAW_TOKENS[shippingStatus]
          ? RETURN_REASON_RAW_TOKENS[shippingStatus]
          : RETURN_STATUS_RAW_TOKENS,
    },
  };
  if (validation === "pending" || validation === "validated") {
    filter.returnValidationStatus = validation;
  }

  const withCollation = (query) => query.collation({ locale: "en", strength: 1 });

  const [docs, total] = await Promise.all([
    withCollation(
      Order.find(filter)
        .select(RETURNS_SELECT)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate({ path: "employeeId", select: "name" })
        .populate({ path: "returnValidatedBy", select: "name" })
    ).lean(),
    withCollation(Order.countDocuments(filter)),
  ]);

  return { returns: docs.map(toReturnSummary), total };
}

/**
 * General entry point for the order-lifecycle page's 3 sections. "all" and
 * "delivered" are plain, uncollated `Order` queries (no accented-status
 * matching involved — "delivered" is decided by `deliveredAt`, not by
 * comparing status text); "returns" delegates to the ORIGINAL, unmodified
 * `queryReturnsForMerchant` above so that section's behavior is exactly
 * what it always was.
 *
 * @param {string} merchantId
 * @param {object} options
 *   `provider`: REQUIRED for every section — "ozon_express" |
 *     "quick_livraison". Ozon and Quick are never mixed in any section
 *     (see this module's own comment).
 *   `section`: "all" | "delivered" | "returns" (default "all")
 *   `shippingStatus`/`validation`: forwarded to `queryReturnsForMerchant`
 *     for the "returns" section only.
 *   `employeeId`: "delivered" section only — already ownership-validated by
 *     the caller (see app/api/returns/route.js); `null`/omitted means every
 *     employee (still merchant-scoped).
 *   `deliveryDateRange`: "delivered" section only — `{start, end}` from
 *     lib/returns/delivery-date.js, or `null` for no date restriction.
 *   `period`: "all" section only — "YYYYMM", already validated by the
 *     caller (see app/api/returns/route.js). Matched against
 *     `numericTrackingNumber`'s own leading "YYYYMM" — the SAME
 *     tracking-number-derived month convention app/api/orders/route.js's
 *     "all employees" browser and lib/commission/report.js already use for
 *     "which month is this order in" — never `createdAt`, never a second
 *     date interpretation. `null`/omitted means every month.
 *   `page`/`pageSize`: every section.
 */
export async function queryOrdersForSection(merchantId, options = {}) {
  const {
    provider,
    section = ORDER_LIFECYCLE_SECTIONS.ALL,
    shippingStatus = "all",
    validation = "all",
    employeeId = null,
    deliveryDateRange = null,
    period = null,
    page = 1,
    pageSize = 20,
  } = options;

  if (section === ORDER_LIFECYCLE_SECTIONS.RETURNS) {
    return queryReturnsForMerchant(merchantId, { provider, shippingStatus, validation, page, pageSize });
  }

  await connectToDatabase();

  const filter = { merchantId, provider };

  if (section === ORDER_LIFECYCLE_SECTIONS.DELIVERED) {
    filter.deliveredAt = deliveryDateRange
      ? { $gte: deliveryDateRange.start, $lt: deliveryDateRange.end }
      : { $ne: null };
  } else if (section === ORDER_LIFECYCLE_SECTIONS.ALL && period) {
    // Same anchored-prefix convention as app/api/orders/route.js and
    // lib/commission/report.js — an order's tracking number, not
    // `createdAt`, decides which month it's in.
    filter.numericTrackingNumber = { $regex: `^${period}` };
  }
  // section === "all" with no period: no status/deliveredAt restriction —
  // literally every order belonging to this merchant, any shipping status.

  if (employeeId) {
    filter.employeeId = employeeId;
  }

  const [docs, total] = await Promise.all([
    Order.find(filter)
      .select(RETURNS_SELECT)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate({ path: "employeeId", select: "name" })
      .populate({ path: "returnValidatedBy", select: "name" })
      .lean(),
    Order.countDocuments(filter),
  ]);

  return { returns: docs.map(toReturnSummary), total };
}

/**
 * Real, non-hardcoded counts for the page's 3 section tabs — "All (X) /
 * Delivered (X) / Returns (X)", scoped to ONE provider (REQUIRED — see this
 * module's own comment: never a combined Ozon+Quick count). Deliberately
 * independent of whichever sub-filters (employee, delivery date, shipping
 * status, validation) are currently applied within a section: these are
 * the section totals, the same way a tab badge normally works. 3 small,
 * indexed count queries run together, never a full document fetch.
 */
export async function getSectionCounts(merchantId, provider) {
  await connectToDatabase();

  const withCollation = (query) => query.collation({ locale: "en", strength: 1 });

  const [all, delivered, returns] = await Promise.all([
    Order.countDocuments({ merchantId, provider }),
    Order.countDocuments({ merchantId, provider, deliveredAt: { $ne: null } }),
    withCollation(
      Order.countDocuments({
        merchantId,
        provider,
        deliveredAt: null,
        lastKnownStatus: { $in: RETURN_STATUS_RAW_TOKENS },
      })
    ),
  ]);

  return { all, delivered, returns };
}
