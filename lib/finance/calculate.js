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
 * `deliveredAt` — see item 17's explicit requirement.
 * Day (for the Daily view's day-by-day breakdown WITHIN a month): tracking
 * numbers do NOT encode the real calendar day (lib/tracking/counter.js's
 * `FIXED_DAY = "01"` is always literally "01", see that module's own
 * comment) — there is no real per-day signal in the tracking number, by
 * design. `createdAt`'s local calendar date is therefore the correct,
 * honest choice for "which day" here — the only real date signal an order
 * actually carries at creation time. This is NOT the same rule violation
 * as "switching to delivery date for MONTH" (item 17) — day-of-creation
 * for a DAILY breakdown and month-of-tracking-number for MONTH totals are
 * two different, both-correct questions, exactly like `deliveredAt` (did
 * it ever deliver) vs. tracking-number month (which month) are already
 * kept separate for Commission.
 *
 * Revenue: ONLY a DELIVERED order counts as real sales revenue (item 12) —
 * a returned/refused/cancelled order's `price` is never counted as
 * revenue, even though its costs (shipping, a share of ad spend) are still
 * real and still counted.
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
import { classifyOrderStatus, classifyReturnReason, ORDER_STATUS_FILTERS } from "@/lib/orders/status-groups";
import { commissionPeriodFromOrder } from "@/lib/commission/resolve-commission-period";
import { dhToCents, sumCents } from "@/lib/finance/money";

const ORDER_FIELDS =
  "provider trackingNumber numericTrackingNumber productNature quantity price providerLocationId city lastKnownStatus deliveredAt createdAt";

/** `Date` -> "YYYY-MM-DD" using LOCAL getters (never UTC/toISOString — see module comment). */
function toLocalDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
 * Which shipping-price COLUMN applies to this order's current status —
 * never assumes every status shares one price (item 10). `null` means
 * "not resolvable yet" (still in progress — no outcome, hence no known
 * shipping-cost column to charge against yet).
 */
function shippingPriceKeyForOrder(provider, status) {
  if (classifyOrderStatus(provider, status) === ORDER_STATUS_FILTERS.DELIVERED) return "deliveredPriceCents";
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
    .select("provider createdAt")
    .lean();

  const dayOrderCounts = new Map(); // dateKey -> {ozon_express, quick_livraison}
  for (const o of allProviderOrders) {
    const key = toLocalDateKey(o.createdAt);
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

  // 5) Walk this provider's orders, bucketed by real calendar day.
  for (const order of providerOrders) {
    const dateKey = toLocalDateKey(order.createdAt);
    if (!daysMap.has(dateKey)) daysMap.set(dateKey, emptyDayRow(dateKey));
    const row = daysMap.get(dateKey);

    const bucket = classifyOrderStatus(order.provider, order.lastKnownStatus);
    row.orders += 1;
    if (bucket === ORDER_STATUS_FILTERS.DELIVERED) row.delivered += 1;
    else if (bucket === ORDER_STATUS_FILTERS.RETURN) row.returned += 1;
    else row.progress += 1;

    const revenueCents = bucket === ORDER_STATUS_FILTERS.DELIVERED ? (dhToCents(order.price) ?? 0) : 0;
    row.revenueCents += revenueCents;

    const unitCostCents = productCostMap.get(normalizeName(order.productNature));
    const quantity = order.quantity ?? 1;
    const productCostCents = unitCostCents != null ? unitCostCents * quantity : null;
    if (productCostCents == null) row.productCostMissing += 1;
    else row.productCostCents += productCostCents;

    const priceKey = shippingPriceKeyForOrder(order.provider, order.lastKnownStatus);
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
