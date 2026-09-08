import { z } from "zod";

/**
 * Server-side request validation for order creation.
 *
 * Field names here are the frontend's neutral names (`receiver`,
 * `productNature`, ...), not Ozon's `parcel-*` wire names — the mapping to
 * `parcel-*` happens once, in app/api/orders/ozon/route.js, right before the
 * Ozon Express call. Validation rules are preserved from the old
 * implementation (Moroccan phone format, numeric price, all fields
 * required).
 */

const phone = z
  .string()
  .trim()
  .regex(/^(06|07)\d{8}$/, "Phone must start with 06 or 07 and be 10 digits.");

const price = z.coerce
  .number({ message: "Price must be a number." })
  .finite("Price must be a number.")
  .nonnegative("Price must be a positive number.");

export const ozonOrderCreateSchema = z.object({
  receiver: z.string().trim().min(1, "Receiver's name is required."),
  phone,
  city: z.string().trim().min(1, "City is required."),
  address: z.string().trim().min(1, "Address is required."),
  productNature: z.string().trim().min(1, "Product nature is required."),
  price,
});
