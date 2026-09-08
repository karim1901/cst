import { z } from "zod";

import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";

/**
 * Server-side request validation for shipping-company configuration.
 *
 * `apiKey` is optional here on purpose: when a provider is already
 * configured, the client never has the real key to send back (see
 * app/api/shipping-companies/route.js), so leaving it blank means "keep the
 * current key". The route enforces that it IS required on first creation.
 */

const ozonId = z
  .string()
  .trim()
  .min(1, "ID is required.")
  .max(128, "ID must be at most 128 characters.");

const apiKey = z
  .string()
  .trim()
  .min(6, "API key must be at least 6 characters.")
  .max(512, "API key is too long.")
  .optional()
  .transform((value) => (value ? value : undefined));

export const shippingCompanySchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal(SHIPPING_PROVIDERS.OZON_EXPRESS),
    ozonId,
    apiKey,
  }),
  z.object({
    provider: z.literal(SHIPPING_PROVIDERS.QUICK_LIVRAISON),
    apiKey,
  }),
]);
