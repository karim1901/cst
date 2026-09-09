import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A merchant's configured per-unit cost for one product — matched against
 * `Order.productNature` (this app's existing single product-name field per
 * order; there is no separate Product catalog/identity system to
 * duplicate — see lib/finance/calculate.js's own comment on why product
 * NAMES, discovered directly from real orders, are the product identity
 * here, not a new id). Case/accent-insensitive matching (the same
 * collation convention already used for status text elsewhere in this
 * app — see models/Order.js's own index) so "Bracelet X" and "bracelet x"
 * resolve to the same configured cost.
 *
 * Cost is NEVER invented: a product with no matching document here is
 * "cost not configured" (see lib/finance/calculate.js), never assumed to
 * be free or estimated.
 */
const productCostSchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "merchantId is required."],
    },
    // Verbatim `Order.productNature` value this cost applies to — never
    // translated/altered (it is real business data, not UI text).
    productName: {
      type: String,
      required: [true, "productName is required."],
      trim: true,
    },
    // Integer centimes — see lib/finance/money.js.
    costPerUnitCents: {
      type: Number,
      required: [true, "costPerUnitCents is required."],
      min: [0, "costPerUnitCents must be 0 or greater."],
    },
  },
  { timestamps: true }
);

productCostSchema.index(
  { merchantId: 1, productName: 1 },
  { unique: true, collation: { locale: "en", strength: 1 } }
);

const ProductCost = mongoose.models.ProductCost || mongoose.model("ProductCost", productCostSchema);

export default ProductCost;
