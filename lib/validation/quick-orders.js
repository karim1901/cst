import { z } from "zod";

/**
 * Server-side request validation for Quick Livraison order creation.
 *
 * Field names here are the frontend's neutral names, not Quick's `deliveries/
 * store` wire names (`district_id`, `name`, `amount`, ...) — that mapping
 * happens once, in app/api/orders/quick/route.js, right before the Quick
 * Livraison call. Same Moroccan phone rule as Ozon Express (see
 * lib/validation/orders.js) since it is a general validation rule, not
 * something specific to either provider.
 */

const phone = z
  .string()
  .trim()
  .regex(/^(06|07)\d{8}$/, "Phone must start with 06 or 07 and be 10 digits.");

const amount = z.coerce
  .number({ message: "Amount must be a number." })
  .finite("Amount must be a number.")
  .nonnegative("Amount must be a positive number.");

const quantity = z.coerce
  .number({ message: "Quantity must be a number." })
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.");

export const quickOrderCreateSchema = z.object({
  receiver: z.string().trim().min(1, "Receiver's name is required."),
  phone,
  districtId: z.string().trim().min(1, "City/district is required."),
  address: z.string().trim().min(1, "Address is required."),
  productName: z.string().trim().min(1, "Product name is required."),
  quantity,
  amount,
  note: z
    .string()
    .trim()
    .max(500, "Note is too long.")
    .optional()
    .transform((value) => (value ? value : undefined)),
  // No `open` field here on purpose: "allow opening before paying" is not a
  // user choice — it is always forced to true server-side (see
  // app/api/orders/quick/route.js). Any `open` sent by the client is simply
  // ignored (unknown keys are stripped by a plain z.object()).
});
