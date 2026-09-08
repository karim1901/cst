import mongoose from "mongoose";

import { encryptSecret } from "../lib/crypto/secret-box.js";
import User from "./User.js";
import { SHIPPING_PROVIDERS, SHIPPING_PROVIDER_VALUES } from "../lib/shipping/providers.js";

const { Schema } = mongoose;

// Re-exported for every existing server-side import of these from this
// model — lib/shipping/providers.js is the actual, client-safe source now
// (see its own comment for why: importing this model pulls in mongoose,
// which cannot be bundled for the browser).
export { SHIPPING_PROVIDERS, SHIPPING_PROVIDER_VALUES };

const isOzonExpress = (provider) => provider === SHIPPING_PROVIDERS.OZON_EXPRESS;

/**
 * A merchant's shipping-provider credentials, used later by the order/
 * shipping system to talk to Ozon Express / Quick Livraison on that
 * merchant's behalf. Exactly one document per (merchant, provider) pair —
 * enforced by a unique compound index plus a find-then-save upsert in the
 * API route (see app/api/shipping-companies/route.js).
 *
 * Owned by a merchant, same as their employees — `merchantId` is always set
 * server-side from the authenticated merchant's session, never from the
 * client, and every query is scoped to it so one merchant can never see or
 * touch another merchant's configuration.
 */
const shippingCompanySchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User", // the owning merchant is itself a User document
      required: [true, "merchantId is required."],
    },

    provider: {
      type: String,
      required: [true, "provider is required."],
      enum: {
        values: [...SHIPPING_PROVIDER_VALUES],
        message: "`{VALUE}` is not a supported shipping provider.",
      },
      // Uniqueness (per merchant) is declared once, explicitly, below.
    },

    // Ozon Express's account/store identifier. Not a secret on its own (no
    // access without the API key), so — unlike apiKey — it is stored and
    // returned as plain text for the settings form to display and edit.
    ozonId: {
      type: String,
      trim: true,
      maxlength: [128, "ozonId must be at most 128 characters long."],
      validate: [
        {
          validator: function (value) {
            return isOzonExpress(this.provider) ? Boolean(value) : true;
          },
          message: "ozonId is required for Ozon Express.",
        },
        {
          validator: function (value) {
            return isOzonExpress(this.provider) ? true : value == null;
          },
          message: "ozonId only applies to Ozon Express.",
        },
      ],
    },

    // Encrypted at rest (AES-256-GCM, see lib/crypto/secret-box.js) and
    // never selected by default — the plaintext never leaves this hook.
    apiKey: {
      type: String,
      required: [true, "apiKey is required."],
      select: false,
    },
    // Last 4 characters of the plaintext key, kept unencrypted so the UI can
    // render "••••••••1234" without ever decrypting the real key.
    apiKeyLast4: {
      type: String,
      select: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { transform: stripSensitive },
    toObject: { transform: stripSensitive },
  }
);

function stripSensitive(_doc, ret) {
  delete ret.apiKey;
  delete ret.apiKeyLast4;
  return ret;
}

/* -------------------------------------------------------------------------- */
/* Indexes.                                                                  */
/* -------------------------------------------------------------------------- */

// One configuration per provider, per merchant.
shippingCompanySchema.index({ merchantId: 1, provider: 1 }, { unique: true });
shippingCompanySchema.index({ merchantId: 1 }); // "all of a merchant's providers"

/* -------------------------------------------------------------------------- */
/* Referential integrity for merchantId — mirrors User's employee.merchantId */
/* check: it must point at an actual merchant.                              */
/* -------------------------------------------------------------------------- */

shippingCompanySchema.path("merchantId").validate(async function (value) {
  if (typeof this.isModified === "function" && !this.isNew && !this.isModified("merchantId")) {
    return true;
  }
  const referenced = await User.exists({ _id: value, role: "merchant" });
  return referenced != null;
}, "merchantId must reference an existing merchant user.");

/* -------------------------------------------------------------------------- */
/* Encrypt the API key before it touches the database. Only one hook is      */
/* needed (unlike User's password/apiKey) because this feature only ever     */
/* writes through `.save()` — see the find-then-save upsert in the route.    */
/* -------------------------------------------------------------------------- */

shippingCompanySchema.pre("save", function () {
  if (!this.isModified("apiKey")) {
    return;
  }
  const plaintext = this.apiKey;
  this.apiKeyLast4 = plaintext.slice(-4);
  this.apiKey = encryptSecret(plaintext);
});

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const ShippingCompany =
  mongoose.models.ShippingCompany || mongoose.model("ShippingCompany", shippingCompanySchema);

export default ShippingCompany;
