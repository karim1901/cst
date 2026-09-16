import { connectToDatabase } from "@/lib/mongodb";
import Order from "@/models/Order";
import { RETURN_STATUS_RAW_TOKENS, RETURN_REASON_RAW_TOKENS } from "@/lib/orders/status-groups";
import { ORDER_LIFECYCLE_SECTIONS } from "@/lib/returns/constants";
import { buildReturnValidationFilter } from "@/lib/returns/validation-filter";
import { ACTIVE_PROVIDER_ORDER_FILTER } from "@/lib/orders/provider-record-status";
import { buildCityNameIndex, resolveOrderCityDisplayName } from "@/lib/orders/city-name-index";

/**
 * Order-lifecycle page (app/dashboard/returns) — reads the local `Order`
 * mirror ONLY (fast, no provider call on this request; see
 * lib/returns/sync.js for the separate synchronization job). Mirrors the
 * shape/conventions of lib/order-followups.js and app/api/orders/route.js's
 * "all employees" browser (same populate-from-Order, same collation-based
 * status matching) rather than introducing a new pattern.
 *
 * `queryReturnsForMerchant` is the ORIGINAL Returns query, still the one
 * used for the "returns" section (see `queryOrdersForSection` below, which
 * simply delegates to it for that section rather than reimplementing it).
 * `queryOrdersForSection` is the newer, general entry point covering all 3
 * sections ("all" / "delivered" / "returns"); nothing about the original
 * Returns shipping-status/validation behavior changed.
 *
 * MONTH FILTER — GLOBAL, page-wide (root-cause fix — see
 * app/_components/returns/ReturnsList.jsx's own comment for the full
 * before/after story): `period` ("YYYYMM", the SAME tracking-number-derived
 * convention app/api/orders/route.js and lib/commission/report.js already
 * use — never `createdAt`) now applies to:
 *   - `queryReturnsForMerchant` (the "returns" section's Returned/Refused/
 *     Cancelled + Pending/Validated sub-filters) — previously had NO month
 *     awareness at all.
 *   - `queryOrdersForSection`'s "all" and "delivered" branches.
 *   - `getSectionCounts` — the 3 tab BADGE numbers ("All Orders (X)" /
 *     "Livré (Y)" / "Retour (Z)") — previously always showed the
 *     merchant's GRAND TOTAL across every month, regardless of which month
 *     was selected elsewhere on the page; that mismatch (a month-scoped
 *     list under a never-scoped badge count) was the visible symptom that
 *     made the page look like it had no working month filter at all.
 * `period` ANDs into the SAME MongoDB filter object as every other active
 * filter (provider, shippingStatus, validation, employeeId,
 * deliveryDateRange) — never a second/parallel query pass — so every
 * combination stays cumulative and no filter can silently drop Month.
 */

const RETURNS_SELECT =
  "employeeId provider trackingNumber receiverName phone city providerLocationId address productNature price lastKnownStatus deliveredAt createdAt updatedAt returnValidationStatus returnValidatedAt returnValidatedBy";

/**
 * Shape returned for one order on the Returns page.
 * @param {object} doc
 * @param {Map<string,string>} [cityNameById] this merchant+provider's
 *   synchronized Ozon city-id -> name index (see
 *   lib/orders/city-name-index.js) — resolves a historical order whose
 *   `city` field was mistakenly stored as the raw provider id (see
 *   app/api/orders/ozon/route.js's own comment); omitted callers just get
 *   `doc.city` verbatim (step 2/4 of the resolver, unchanged behavior).
 */
export function toReturnSummary(doc, cityNameById) {
  return {
    id: String(doc._id),
    provider: doc.provider,
    trackingNumber: doc.trackingNumber,
    employee: doc.employeeId
      ? { id: String(doc.employeeId._id ?? doc.employeeId), name: doc.employeeId.name ?? null }
      : null,
    receiver: doc.receiverName,
    phone: doc.phone,
    city: resolveOrderCityDisplayName(doc, cityNameById),
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
 * @param {{provider: string, shippingStatus?: string, validation?: string, period?: string|null, page?: number, pageSize?: number}} options
 *   `provider`: REQUIRED — "ozon_express" | "quick_livraison". Ozon and
 *   Quick returns are never combined into one list (see this page's own
 *   module comment / app/_components/returns/ReturnsList.jsx's
 *   ProviderTabs).
 *   `shippingStatus`: "all" | "cancelled" | "refused" | "returned"
 *   `validation`: "all" | "pending" | "validated"
 *   `period`: "YYYYMM" or `null`/omitted for "All Months" — see this
 *   module's own comment for the month-filter fix; matched against
 *   `numericTrackingNumber`'s leading "YYYYMM", identical to every other
 *   month filter in this app.
 */
export async function queryReturnsForMerchant(merchantId, options = {}) {
  const { provider, shippingStatus = "all", validation = "all", period = null, page = 1, pageSize = 20 } = options;

  await connectToDatabase();

  const filter = {
    merchantId,
    provider,
    // A confirmed provider-deleted order (lib/orders/provider-record-status.js)
    // is not an active return to manage — it stays in Mongo for audit, but
    // drops out of every operational view, same as Finance.
    providerRecordStatus: ACTIVE_PROVIDER_ORDER_FILTER,
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
  // See lib/returns/validation-filter.js's own comment for why "pending"
  // must match a missing field too (a legacy return from before this field
  // existed), not just the literal string.
  const validationFilter = buildReturnValidationFilter(validation);
  if (validationFilter !== undefined) {
    filter.returnValidationStatus = validationFilter;
  }
  // MONTH FILTER FIX — see this module's own comment. Same anchored-prefix
  // convention as the "all"/"delivered" query below: ANDed into the SAME
  // filter object as shippingStatus/validation above, so Month keeps
  // narrowing the result no matter which Return Status is selected.
  if (period) {
    filter.numericTrackingNumber = { $regex: `^${period}` };
  }

  const withCollation = (query) => query.collation({ locale: "en", strength: 1 });

  const [docs, total, cityNameById] = await Promise.all([
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
    buildCityNameIndex(merchantId, provider),
  ]);

  return { returns: docs.map((doc) => toReturnSummary(doc, cityNameById)), total };
}

/**
 * General entry point for the order-lifecycle page's 3 sections. "all" and
 * "delivered" are plain, uncollated `Order` queries (no accented-status
 * matching involved — "delivered" is decided by `deliveredAt`, not by
 * comparing status text); "returns" delegates to `queryReturnsForMerchant`
 * above, now including `period` too (see that function's own comment for
 * the month-filter fix) so that section's Return Status sub-filters
 * (Returned/Pending/Validated) never lose the selected month — the ONLY
 * thing that changed about the original Returns behavior.
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
 *     lib/returns/delivery-date.js, or `null` for no date restriction. A
 *     DIFFERENT, deliberately independent axis from `period` below: this is
 *     "was it delivered today/this week/in this custom range" (real
 *     `deliveredAt`), never conflated with "which tracking-number month is
 *     this order in" — both apply TOGETHER (AND), never one replacing the
 *     other.
 *   `period`: EVERY section, including "delivered" now (month-filter fix) —
 *     "YYYYMM", already validated by the caller (see
 *     app/api/returns/route.js). Matched against `numericTrackingNumber`'s
 *     own leading "YYYYMM" — the SAME tracking-number-derived month
 *     convention app/api/orders/route.js's "all employees" browser and
 *     lib/commission/report.js already use for "which month is this order
 *     in" — never `createdAt`, never a second date interpretation.
 *     `null`/omitted means every month.
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
    return queryReturnsForMerchant(merchantId, { provider, shippingStatus, validation, period, page, pageSize });
  }

  await connectToDatabase();

  const filter = { merchantId, provider, providerRecordStatus: ACTIVE_PROVIDER_ORDER_FILTER };

  if (section === ORDER_LIFECYCLE_SECTIONS.DELIVERED) {
    filter.deliveredAt = deliveryDateRange
      ? { $gte: deliveryDateRange.start, $lt: deliveryDateRange.end }
      : { $ne: null };
  }
  // MONTH FILTER FIX: applied for EVERY section now (previously "all"
  // only) — ANDs with the deliveredAt restriction above for "delivered"
  // rather than replacing it, so Month + Delivery Date narrow together.
  // Same anchored-prefix convention as app/api/orders/route.js and
  // lib/commission/report.js — an order's tracking number, not
  // `createdAt`, decides which month it's in.
  if (period) {
    filter.numericTrackingNumber = { $regex: `^${period}` };
  }
  // section === "all" with no period: no status/deliveredAt restriction —
  // literally every order belonging to this merchant, any shipping status.

  if (employeeId) {
    filter.employeeId = employeeId;
  }

  const [docs, total, cityNameById] = await Promise.all([
    Order.find(filter)
      .select(RETURNS_SELECT)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate({ path: "employeeId", select: "name" })
      .populate({ path: "returnValidatedBy", select: "name" })
      .lean(),
    Order.countDocuments(filter),
    buildCityNameIndex(merchantId, provider),
  ]);

  return { returns: docs.map((doc) => toReturnSummary(doc, cityNameById)), total };
}

/**
 * Real, non-hardcoded counts for the page's 3 section tabs — "All (X) /
 * Delivered (X) / Returns (X)", scoped to ONE provider (REQUIRED — see this
 * module's own comment: never a combined Ozon+Quick count) AND, since the
 * month-filter fix, to the SAME selected `period` every other query on this
 * page uses. Root cause this closes: these 3 badge numbers used to be the
 * merchant's GRAND TOTAL across every month unconditionally — with a
 * month-scoped LIST underneath an un-scoped badge, the page visibly looked
 * like Month "did nothing" even once the list itself was correctly
 * filtered. Still deliberately independent of the FINER sub-filters
 * (employee, delivery date, shipping status, validation) — these remain the
 * section totals FOR THE SELECTED MONTH, the same way a tab badge normally
 * works, not a live count of the current sub-filtered list. 3 small,
 * indexed count queries run together, never a full document fetch.
 *
 * @param {string} merchantId
 * @param {string} provider
 * @param {string|null} [period] "YYYYMM", or `null`/omitted for "All Months"
 *   (unscoped totals — the original behavior, still available as an
 *   explicit user choice, never the silent default anymore).
 */
export async function getSectionCounts(merchantId, provider, period = null) {
  await connectToDatabase();

  const withCollation = (query) => query.collation({ locale: "en", strength: 1 });

  const baseFilter = { merchantId, provider, providerRecordStatus: ACTIVE_PROVIDER_ORDER_FILTER };
  if (period) {
    baseFilter.numericTrackingNumber = { $regex: `^${period}` };
  }

  const [all, delivered, returns] = await Promise.all([
    Order.countDocuments(baseFilter),
    Order.countDocuments({ ...baseFilter, deliveredAt: { $ne: null } }),
    withCollation(
      Order.countDocuments({
        ...baseFilter,
        deliveredAt: null,
        lastKnownStatus: { $in: RETURN_STATUS_RAW_TOKENS },
      })
    ),
  ]);

  return { all, delivered, returns };
}
