import { connectToDatabase } from "@/lib/mongodb";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";

/**
 * Shape returned for a shipping-company configuration — used by the
 * Shipping Companies page and `GET /api/shipping-companies`. Never includes
 * the API key itself, only a masked hint built from the last-4 digits kept
 * alongside the encrypted key.
 */
export function toShippingCompanySummary(doc) {
  return {
    id: String(doc._id),
    provider: doc.provider,
    ozonId: doc.provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (doc.ozonId ?? null) : null,
    apiKeyMasked: doc.apiKeyLast4 ? `••••••••${doc.apiKeyLast4}` : null,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * A single merchant's configured providers (0, 1 or 2 documents). Always
 * scoped to `merchantId` — there is no way to pass another merchant's id in,
 * so this can never leak another merchant's shipping credentials.
 * Server-side only.
 */
export async function listShippingCompaniesForMerchant(merchantId) {
  await connectToDatabase();
  // `apiKeyLast4` is `select: false` by default (like `apiKey`); opt back in
  // here — it is safe (just 4 characters) and needed to render the masked
  // "••••••••1234" hint. `apiKey` itself is never selected.
  const docs = await ShippingCompany.find({ merchantId })
    .select("+apiKeyLast4")
    .sort({ provider: 1 })
    .exec();
  return docs.map(toShippingCompanySummary);
}
