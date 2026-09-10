/**
 * Centralized financial calculation service — THE one place Advertising,
 * Product Costs, Shipping Costs, Other Expenses, Revenue and Profit are
 * ever computed (item 20's explicit requirement: never a second
 * implementation in the Dashboard, a Finance page, an order card, or
 * daily/monthly statistics separately — they all call into this module,
 * so they can never disagree).
 *
 * Money: every monetary VALUE this module reads/returns is an INTEGER
 * number of centimes (see lib/finance/money.js) — never a raw float DH
 * amount — so summing hundreds of orders across a month never accumulates
 * floating-point error.
 *
 * Month: an order's financial MONTH is its tracking number's own period
 * (lib/commission/resolve-commission-period.js#commissionPeriodFromOrder —
 * the SAME centralized rule Commission already uses), never `createdAt`/
 * `deliveredAt` — see item 17's explicit requirement. THIS IS UNCHANGED.
 *
 * Day (for the Daily view's day-by-day breakdown WITHIN a month): the
 * order's REAL provider creation date — `Order.orderDate` (Quick's
 * `date_creation`, Ozon's earliest history step; see models/Order.js and
 * lib/finance/business-date.js), formatted in the explicit
 * `Africa/Casablanca` business timezone. NEVER `createdAt`: that is the
 * MongoDB insert timestamp, which for a historically-synced order is the
 * day the SYNC ran (dozens of real orders from different days would
 * otherwise pile onto one "day"). A legacy row not yet backfilled
 * (`orderDate == null`) falls back to `createdAt` ONLY so it is not
 * dropped from the day/month total, and every such order is counted in
 * `orderDateMissing` so the report can flag the day as approximate.
 * Three DISTINCT date concepts, deliberately never conflated:
 *   - commission / financial MONTH  -> tracking-number "YYYYMM" (unchanged)
 *   - business DAY                   -> orderDate (real provider creation)
 *   - createdAt                      -> DB insert / audit timestamp only
 *
 * Delivered: the ONE canonical application signal — `deliveredAt` is set
 * (lib/commission/resolve-delivery-date.js#resolveOrderDeliveredAt), the
 * SAME rule the Dashboard (lib/orders/dashboard-stats.js) and Commission
 * already use — never a Finance-only "status text == Livré" definition.
 * `returned` = a non-delivered order whose `lastKnownStatus` is a return
 * token (lib/orders/status-groups.js#isReturnStatus); `progress` = the
 * rest. Identical buckets to computeOrderDeliveryStats.
 *
 * Revenue: ONLY a DELIVERED order counts as real sales revenue (item 12) —
 * a returned/refused/cancelled order's `price` is never counted as
 * revenue, even though its costs (shipping, a share of ad spend) are still
 * real and still counted.
 *
 * Return Value (`returnValueCents`): the total monetary VALUE (`order.price`,
 * the same canonical field revenue uses) of the RETURN-bucket orders
 * (Returned / Refused / Cancelled per classifyReturnReason) that have NOT
 * yet been physically validated — `returnValidationStatus !== "validated"`
 * (models/Order.js / lib/returns/constants.js). A validated return is
 * money already accounted for and contributes 0. The Retour COUNT
 * (`returned`) still includes every return-bucket order, validated or not.
 * A REPORTING metric only — never subtracted from profit, never added to
 * any cost (Profit unchanged). An unknown Quick price (priceSource
 * "unknown") on a PENDING return is NOT fabricated as 0: excluded from the
 * total, counted in `returnValueUnknownPriceOrders`. See
 * lib/finance/return-value.js.
 *
 * Advertising allocation (item 18/19 — must reconcile EXACTLY, never
 * double-count): a daily AdvertisingExpense entry scoped to one specific
 * provider counts ONLY for that provider. An entry scoped to "all" (spend
 * not attributable to one provider) is split, for a given day, in
 * proportion to that day's ACTUAL order-count share between Ozon and Quick
 * for this merchant — so the two providers' allocated shares of one "all"
 * entry always sum back to exactly that entry's amount, never more.
 *
 * Shipping cost: Ozon uses its REAL per-city, per-status price (synced
 * from the provider's own API — see lib/finance/sync-city-pricing.js).
 * Quick has no such API (verified live) — a merchant-configured FLAT rate
 * applies to every Quick order instead (see models/ProviderCityPricing.js#
 * FLAT_RATE_CITY_ID). Either way: a price this system does not actually
 * know is `null` ("not configured"), NEVER assumed to be 0 — see item 6/10.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/finance/calculate.js is server-only and must not be imported in client code");
}

import mongoose from "mongoose";

import Order from "@/models/Order";
import ProductCost from "@/models/ProductCost";
import ProviderCityPricing, { FLAT_RATE_CITY_ID } from "@/models/ProviderCityPricing";
import AdvertisingExpense from "@/models/AdvertisingExpense";
import OtherExpense from "@/models/OtherExpense";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { classifyReturnReason, ORDER_STATUS_FILTERS } from "@/lib/orders/status-groups";
import { RETURN_VALIDATION_STATUSES } from "@/lib/returns/constants";
import { resolveOrderDeliveredAt } from "@/lib/commission/resolve-delivery-date";
import { isUsableCommissionPrice } from "@/lib/commission/calculate";
import { dhToCents, sumCents } from "@/lib/finance/money";
import { businessDateKey, businessDateForOrder, orderDateIsApproximate } from "@/lib/finance/business-date";
import { returnValueContribution } from "@/lib/finance/return-value";

const ORDER_FIELDS =
  "provider trackingNumber numericTrackingNumber productNature quantity price providerLocationId city lastKnownStatus deliveredAt orderDate createdAt returnValidationStatus";

/** How many calendar days a "YYYYMM" period spans, local time. */
function daysInPeriod(period) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  return new Date(year, month, 0).getDate();
}

function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Which shipping-price COLUMN applies to this order — never assumes every
 * outcome shares one price (item 10). Delivered is the canonical
 * `deliveredAt` signal (not status text); a non-delivered order's return
 * REASON decides between the refused/returned columns; `null` means "no
 * outcome yet" (still in progress — no shipping-cost column to charge).
 *
 * @param {boolean} delivered  resolveOrderDeliveredAt(order) != null
 * @param {string|null} status  order.lastKnownStatus (only for the return-reason split)
 */
function shippingPriceKeyForOrder(delivered, status) {
  if (delivered) return "deliveredPriceCents";
  const reason = classifyReturnReason(status);
  if (reason === "refused") return "refusedPriceCents";
  // "returned" and "cancelled" share the RETURNED price — Ozon's API has
  // no separate CANCELLED price, and a cancelled order was never actually
  // shipped-then-returned, but this is the safest available existing
  // price column rather than inventing a new one (item 10's explicit
  // instruction) — documented here, not silently assumed elsewhere.
  if (reason === "returned" || reason === "cancelled") return "returnedPriceCents";
  return null; // still in progress
}

/**
 * Proportionally allocate one day's "all"-scoped advertising spend between
 * providers by that day's REAL order-count share — see module comment.
 * Provider-specific entries are added on top, untouched, never re-split.
 */
function resolveDailyAdSpendCents(adEntriesForDate, provider, dayOrderCounts) {
  const specific = sumCents(
    adEntriesForDate.filter((e) => e.provider === provider).map((e) => e.amountCents)
  );
  const allAmount = sumCents(adEntriesForDate.filter((e) => e.provider === "all").map((e) => e.amountCents));
  if (allAmount === 0) return specific;

  const ozonCount = dayOrderCounts?.[SHIPPING_PROVIDERS.OZON_EXPRESS] ?? 0;
  const quickCount = dayOrderCounts?.[SHIPPING_PROVIDERS.QUICK_LIVRAISON] ?? 0;
  const totalCount = ozonCount + quickCount;
  const thisProviderCount = dayOrderCounts?.[provider] ?? 0;
  const allocatedFromAll = totalCount > 0 ? Math.round(allAmount * (thisProviderCount / totalCount)) : 0;

  return specific + allocatedFromAll;
}

function emptyDayRow(date) {
  return {
    date,
    orders: 0,
    delivered: 0,
    returned: 0,
    progress: 0,
    revenueCents: 0,
    adSpendCents: 0,
    productCostCents: 0,
    productCostMissing: 0, // count of orders with an unconfigured product cost
    shippingCostCents: 0,
    shippingCostMissing: 0, // count of orders with an unresolved shipping cost
    orderDateMissing: 0, // count of orders placed on this day by the createdAt fallback (no real provider date yet)
    // Return Value: total monetary VALUE (order price) of return-category
    // orders — an ADDITIVE reporting metric, never fed into profit/cost.
    returnValueCents: 0,
    returnValueUnknownPriceOrders: 0, // return orders whose price is unknown (excluded from the total, surfaced as a warning)
    otherExpenseCents: 0,
    orderRows: [],
  };
}

/**
 * The ONE calculation this whole system is built on. Computes a full
 * calendar-month's financials for ONE merchant + ONE provider (never
 * combined — item 4/16), broken down by real calendar day (`days`, the
 * Daily view's data) AND summed into month-wide `totals` (the Monthly
 * view's data) — computed from the exact same day rows, so the two views
 * can never disagree (item 20/31).
 *
 * @param {string} merchantId
 * @param {string} provider "ozon_express" | "quick_livraison"
 * @param {string} period "YYYYMM"
 */
export async function calculateMonthlyFinancials(merchantId, provider, period) {
  const merchantObjectId = new mongoose.Types.ObjectId(merchantId);

  // 1) This provider's own orders for the month (tracking-number month —
  // the centralized, unchanged commission rule).
  const providerOrders = await Order.find({
    merchantId: merchantObjectId,
    provider,
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select(ORDER_FIELDS)
    .lean();

  // 2) EVERY provider's orders for the month, lightweight projection only —
  // needed to allocate "all"-scoped daily ad spend by real cross-provider
  // order-count share (see resolveDailyAdSpendCents). One query, not one
  // per day.
  const allProviderOrders = await Order.find({
    merchantId: merchantObjectId,
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select("provider orderDate createdAt")
    .lean();

  const dayOrderCounts = new Map(); // dateKey -> {ozon_express, quick_livraison}
  for (const o of allProviderOrders) {
    const key = businessDateKey(businessDateForOrder(o));
    if (key == null) continue;
    if (!dayOrderCounts.has(key)) {
      dayOrderCounts.set(key, { [SHIPPING_PROVIDERS.OZON_EXPRESS]: 0, [SHIPPING_PROVIDERS.QUICK_LIVRAISON]: 0 });
    }
    dayOrderCounts.get(key)[o.provider] += 1;
  }

  // 3) Product costs (merchant-wide — a product name is not provider-
  // specific) and this provider's city pricing.
  const [productCostDocs, cityPricingDocs, adExpenseDocs, otherExpenseDocs] = await Promise.all([
    ProductCost.find({ merchantId: merchantObjectId }).select("productName costPerUnitCents").lean(),
    ProviderCityPricing.find({ merchantId: merchantObjectId, provider })
      .select("cityId cityName deliveredPriceCents returnedPriceCents refusedPriceCents")
      .lean(),
    AdvertisingExpense.find({
      merchantId: merchantObjectId,
      date: { $gte: `${period.slice(0, 4)}-${period.slice(4, 6)}-01`, $lte: `${period.slice(0, 4)}-${period.slice(4, 6)}-31` },
    })
      .select("provider date amountCents")
      .lean(),
    OtherExpense.find({
      merchantId: merchantObjectId,
      provider: { $in: ["all", provider] },
      date: { $gte: `${period.slice(0, 4)}-${period.slice(4, 6)}-01`, $lte: `${period.slice(0, 4)}-${period.slice(4, 6)}-31` },
    })
      .select("amountCents date title")
      .lean(),
  ]);

  const productCostMap = new Map(
    productCostDocs.map((doc) => [normalizeName(doc.productName), doc.costPerUnitCents])
  );
  const cityPricingMap = new Map(cityPricingDocs.map((doc) => [doc.cityId, doc]));
  // Fallback index by normalized city NAME — some real historical orders
  // predate `Order.providerLocationId` being populated (verified against
  // real data: older orders only ever stored the human-readable `city`
  // name, never Ozon's numeric id) — matching by name is still exact and
  // correct, just a second, equally real key into the same synced pricing
  // documents, never a guess.
  const cityPricingByName = new Map(
    cityPricingDocs.map((doc) => [normalizeName(doc.cityName), doc])
  );

  const adEntriesByDate = new Map(); // dateKey -> [{provider, amountCents}]
  for (const doc of adExpenseDocs) {
    if (!adEntriesByDate.has(doc.date)) adEntriesByDate.set(doc.date, []);
    adEntriesByDate.get(doc.date).push({ provider: doc.provider, amountCents: doc.amountCents });
  }

  const totalOtherExpenseCents = sumCents(otherExpenseDocs.map((doc) => doc.amountCents));

  // 4) Build every real calendar day of the month upfront (so a day with
  // zero orders still legitimately shows its advertising/other-expense
  // spend, never silently dropped).
  const daysMap = new Map();
  const dim = daysInPeriod(period);
  for (let day = 1; day <= dim; day++) {
    const key = `${period.slice(0, 4)}-${period.slice(4, 6)}-${String(day).padStart(2, "0")}`;
    daysMap.set(key, emptyDayRow(key));
  }

  // 5) Walk this provider's orders, bucketed by REAL business day (the
  // order's provider creation date, Africa/Casablanca — see module
  // comment). A row not yet backfilled falls back to createdAt and is
  // tallied in `orderDateMissing`.
  for (const order of providerOrders) {
    const dateKey = businessDateKey(businessDateForOrder(order));
    // A completely date-less order (no orderDate AND no createdAt — should
    // never happen, Mongoose always stamps createdAt) is the only thing
    // that could land here; skip it rather than invent a day.
    if (dateKey == null) continue;
    if (!daysMap.has(dateKey)) daysMap.set(dateKey, emptyDayRow(dateKey));
    const row = daysMap.get(dateKey);

    // Delivered = the canonical `deliveredAt` signal (same as Dashboard /
    // Commission), NOT status text. Return / progress split as in
    // computeOrderDeliveryStats.
    const delivered = resolveOrderDeliveredAt(order) != null;
    const bucket = delivered
      ? ORDER_STATUS_FILTERS.DELIVERED
      : classifyReturnReason(order.lastKnownStatus)
        ? ORDER_STATUS_FILTERS.RETURN
        : ORDER_STATUS_FILTERS.PROGRESS;
    row.orders += 1;
    if (delivered) row.delivered += 1;
    else if (bucket === ORDER_STATUS_FILTERS.RETURN) row.returned += 1;
    else row.progress += 1;
    if (orderDateIsApproximate(order)) row.orderDateMissing += 1;

    const revenueCents = delivered ? (dhToCents(order.price) ?? 0) : 0;
    row.revenueCents += revenueCents;

    // Return Value — the monetary VALUE of return-category orders that are
    // still awaiting physical return (returnValidationStatus not
    // "validated"). Same canonical price field as revenue. A VALIDATED
    // return contributes nothing — its value is already accounted for. The
    // Retour COUNT above still includes every return-bucket order, validated
    // or not. Additive metric only: NEVER subtracted from profit or added
    // to any cost. An unknown Quick price is not fabricated — a PENDING
    // return with an unknown price is left out of the total and counted as
    // a warning (see lib/finance/return-value.js).
    const rv = returnValueContribution({
      isReturn: !delivered && bucket === ORDER_STATUS_FILTERS.RETURN,
      isValidated: order.returnValidationStatus === RETURN_VALIDATION_STATUSES.VALIDATED,
      priceUsable: isUsableCommissionPrice(order.price),
      priceCents: dhToCents(order.price) ?? 0,
    });
    row.returnValueCents += rv.valueCents;
    row.returnValueUnknownPriceOrders += rv.unknownPriceOrders;

    const unitCostCents = productCostMap.get(normalizeName(order.productNature));
    const quantity = order.quantity ?? 1;
    const productCostCents = unitCostCents != null ? unitCostCents * quantity : null;
    if (productCostCents == null) row.productCostMissing += 1;
    else row.productCostCents += productCostCents;

    const priceKey = shippingPriceKeyForOrder(delivered, order.lastKnownStatus);
    const cityDoc =
      order.provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON
        ? cityPricingMap.get(FLAT_RATE_CITY_ID)
        : (cityPricingMap.get(order.providerLocationId) ?? cityPricingByName.get(normalizeName(order.city)));
    const shippingCostCents = priceKey && cityDoc ? cityDoc[priceKey] : null;
    if (priceKey != null && shippingCostCents == null) row.shippingCostMissing += 1;
    else if (shippingCostCents != null) row.shippingCostCents += shippingCostCents;

    row.orderRows.push({
      id: String(order._id),
      trackingNumber: order.trackingNumber,
      productNature: order.productNature,
      quantity,
      status: order.lastKnownStatus,
      statusBucket: bucket,
      priceCents: dhToCents(order.price) ?? 0,
      revenueCents,
      productCostCents,
      shippingCostCents,
    });
  }

  // 6) Ad spend + profit, per day — needs the day's own order-count-based
  // allocation (step 5 must have already populated `row.orders` above).
  for (const [dateKey, row] of daysMap) {
    const entries = adEntriesByDate.get(dateKey) ?? [];
    row.adSpendCents = resolveDailyAdSpendCents(entries, provider, dayOrderCounts.get(dateKey));
  }

  // Other expenses are a MONTH-level deduction (item 19 — never multiplied
  // per order/day); shown once, on the totals, not split across days.
  const days = Array.from(daysMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  const totals = {
    orders: sumCents(days.map((d) => d.orders)),
    delivered: sumCents(days.map((d) => d.delivered)),
    returned: sumCents(days.map((d) => d.returned)),
    progress: sumCents(days.map((d) => d.progress)),
    revenueCents: sumCents(days.map((d) => d.revenueCents)),
    adSpendCents: sumCents(days.map((d) => d.adSpendCents)),
    productCostCents: sumCents(days.map((d) => d.productCostCents)),
    productCostMissing: sumCents(days.map((d) => d.productCostMissing)),
    shippingCostCents: sumCents(days.map((d) => d.shippingCostCents)),
    shippingCostMissing: sumCents(days.map((d) => d.shippingCostMissing)),
    // Orders that had to be placed on a day by their `createdAt` because no
    // real provider creation date is stored yet — the day breakdown for
    // this month is approximate to that extent (run
    // scripts/backfill-order-date.mjs to resolve them). SUM(daily orders)
    // still equals this monthly `orders` count either way.
    orderDateMissing: sumCents(days.map((d) => d.orderDateMissing)),
    // Return Value — SUM of the daily return values (so the two views
    // reconcile exactly). Additive metric, never part of totalCost/profit.
    returnValueCents: sumCents(days.map((d) => d.returnValueCents)),
    returnValueUnknownPriceOrders: sumCents(days.map((d) => d.returnValueUnknownPriceOrders)),
    otherExpenseCents: totalOtherExpenseCents,
  };
  totals.totalCostCents =
    totals.productCostCents + totals.adSpendCents + totals.shippingCostCents + totals.otherExpenseCents;
  totals.profitCents = totals.revenueCents - totals.totalCostCents;
  // Incomplete data (an unconfigured product/shipping cost somewhere this
  // month) means the profit figure understates true cost — flagged, never
  // silently presented as exact (item 6/29).
  totals.profitComplete = totals.productCostMissing === 0 && totals.shippingCostMissing === 0;

  // Per-day totalCost/profit, same formula, for the Daily view's cards.
  for (const row of days) {
    row.totalCostCents = row.productCostCents + row.adSpendCents + row.shippingCostCents;
    row.profitCents = row.revenueCents - row.totalCostCents;
    row.profitComplete = row.productCostMissing === 0 && row.shippingCostMissing === 0;
  }

  // Documented, clearly-denominated ratios (item 14 — "clearly define the
  // denominator for each metric").
  const ratios = {
    // Ad cost per order (ALL orders this provider had this month) / per
    // delivered order — two distinct, separately-shown denominators
    // (item 3's explicit requirement), never conflated.
    adCostPerOrderCents: totals.orders > 0 ? Math.round(totals.adSpendCents / totals.orders) : null,
    adCostPerDeliveredCents: totals.delivered > 0 ? Math.round(totals.adSpendCents / totals.delivered) : null,
    profitPerDeliveredCents: totals.delivered > 0 ? Math.round(totals.profitCents / totals.delivered) : null,
    averageOrderValueCents: totals.delivered > 0 ? Math.round(totals.revenueCents / totals.delivered) : null,
    // Denominator: every order this provider had this month (delivered +
    // returned + progress) — "of everything shipped this month, what
    // share resolved as delivered / as a return".
    deliveryRate: totals.orders > 0 ? totals.delivered / totals.orders : null,
    returnRate: totals.orders > 0 ? totals.returned / totals.orders : null,
  };

  return { provider, period, totals, ratios, days };
}
