import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import ProviderCityPricing, { FLAT_RATE_CITY_ID } from "@/models/ProviderCityPricing";
import { SHIPPING_PROVIDER_VALUES, SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { syncOzonCityPricing } from "@/lib/finance/sync-city-pricing";
import { dhToCents, centsToDh } from "@/lib/finance/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireMerchant() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return { error: NextResponse.json({ error: "Only merchants can manage Finance." }, { status: 403 }) };
  }
  return { currentUser };
}

function toSummary(doc) {
  return {
    id: String(doc._id),
    provider: doc.provider,
    cityId: doc.cityId,
    cityName: doc.cityName,
    deliveredPrice: doc.deliveredPriceCents != null ? centsToDh(doc.deliveredPriceCents) : null,
    returnedPrice: doc.returnedPriceCents != null ? centsToDh(doc.returnedPriceCents) : null,
    refusedPrice: doc.refusedPriceCents != null ? centsToDh(doc.refusedPriceCents) : null,
    source: doc.source,
    lastSyncedAt: doc.lastSyncedAt,
  };
}

/** This merchant's shipping-price entries for one provider — real per-city
 * rows for Ozon (synced from its API — see POST below), one flat-rate row
 * for Quick (no such API exists — see PATCH below). */
export async function GET(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const provider = new URL(request.url).searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  await connectToDatabase();
  const docs = await ProviderCityPricing.find({ merchantId: currentUser.id, provider })
    .sort({ cityName: 1 })
    .lean();

  return NextResponse.json({ provider, pricing: docs.map(toSummary) });
}

/**
 * Sync Ozon Express's real per-city prices from its own public API — see
 * lib/finance/sync-city-pricing.js. Ozon-only: Quick Livraison has no such
 * API (verified live), so this 400s for it — use PATCH instead.
 */
export async function POST(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  let body = null;
  try {
    body = await request.json();
  } catch {
    // no body is fine, nothing else this route reads is optional
  }
  if (body?.provider !== SHIPPING_PROVIDERS.OZON_EXPRESS) {
    return NextResponse.json(
      { error: "Only Ozon Express supports syncing city prices from its own API." },
      { status: 400 }
    );
  }

  await connectToDatabase();

  try {
    const result = await syncOzonCityPricing(currentUser.id, request.signal);
    return NextResponse.json({ ok: true, synced: result.synced });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.error("[POST /api/finance/city-pricing]", err?.message);
    return NextResponse.json({ error: "Could not reach Ozon Express." }, { status: err?.statusCode || 502 });
  }
}

/**
 * Set Quick Livraison's merchant-configured FLAT shipping rate (delivered/
 * returned/refused) — the one place a merchant enters it, since no
 * provider API exists to sync it from (see models/ProviderCityPricing.js's
 * own comment). Also usable to manually override/correct one specific
 * Ozon city if a merchant knows a price differs from the synced value.
 */
export async function PATCH(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const provider = body?.provider;
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 422 });
  }
  const cityId =
    provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON ? FLAT_RATE_CITY_ID : String(body?.cityId ?? "").trim();
  if (!cityId) {
    return NextResponse.json({ error: "cityId is required for Ozon Express." }, { status: 422 });
  }

  const deliveredPriceCents = body?.deliveredPrice != null ? dhToCents(body.deliveredPrice) : undefined;
  const returnedPriceCents = body?.returnedPrice != null ? dhToCents(body.returnedPrice) : undefined;
  const refusedPriceCents = body?.refusedPrice != null ? dhToCents(body.refusedPrice) : undefined;

  await connectToDatabase();

  const update = { source: "manual" };
  if (deliveredPriceCents !== undefined) update.deliveredPriceCents = deliveredPriceCents;
  if (returnedPriceCents !== undefined) update.returnedPriceCents = returnedPriceCents;
  if (refusedPriceCents !== undefined) update.refusedPriceCents = refusedPriceCents;
  if (cityId === FLAT_RATE_CITY_ID) update.cityName = "Flat rate (all cities)";
  else if (body?.cityName) update.cityName = String(body.cityName).trim();

  const doc = await ProviderCityPricing.findOneAndUpdate(
    { merchantId: currentUser.id, provider, cityId },
    { $set: update },
    { upsert: true, new: true }
  );

  return NextResponse.json({ pricing: toSummary(doc) }, { status: 201 });
}
