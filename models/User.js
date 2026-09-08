import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { encryptSecret } from "../lib/crypto/secret-box.js";

const { Schema } = mongoose;

/**
 * The three — and only three — kinds of user in the application.
 *
 *  - super_admin: operates the whole platform, not tied to any merchant.
 *  - merchant:    a business owner; the parent/owner of its employees.
 *  - employee:    acts on behalf of exactly one merchant.
 */
export const USER_ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  MERCHANT: "merchant",
  EMPLOYEE: "employee",
});

export const USER_ROLE_VALUES = Object.freeze(Object.values(USER_ROLES));

// bcrypt work factor. 12 is a sensible production default.
const SALT_ROUNDS = 12;

// Practical HTML5-style email check. Kept deliberately strict but simple;
// deeper verification belongs to a confirmation-email flow, not the schema.
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Login handle for employees (merchants/super admins keep using email).
const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9_.]{1,30}[a-z0-9])?$/;

const PHONE_REGEX = /^[0-9+()\-\s]{6,20}$/;

const isEmployee = (role) => role === USER_ROLES.EMPLOYEE;

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

// A real (explicit) sub-schema, not a bare nested object literal, so it
// compiles to a proper single-nested-subdocument path — which is what lets
// the "required for employees" check below attach to `commission` as a whole
// via `userSchema.path("commission")`, the same way `merchantId` does.
const commissionSchema = new Schema(
  {
    threshold: {
      type: Number,
      min: [0, "commission.threshold cannot be negative."],
      validate: {
        validator: (value) => value === undefined || isNonNegativeInteger(value),
        message: "commission.threshold must be a whole, non-negative number.",
      },
    },
    commissionBelowThreshold: {
      type: Number,
      min: [0, "commission.commissionBelowThreshold cannot be negative."],
      validate: {
        validator: (value) => value === undefined || isNonNegativeInteger(value),
        message: "commission.commissionBelowThreshold must be a whole, non-negative number.",
      },
    },
    commissionAtOrAboveThreshold: {
      type: Number,
      min: [0, "commission.commissionAtOrAboveThreshold cannot be negative."],
      validate: {
        validator: (value) => value === undefined || isNonNegativeInteger(value),
        message: "commission.commissionAtOrAboveThreshold must be a whole, non-negative number.",
      },
    },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "name is required."],
      trim: true,
      minlength: [2, "name must be at least 2 characters long."],
      maxlength: [120, "name must be at most 120 characters long."],
    },

    // Login identifier for merchants and super admins. Employees log in with
    // `username` instead (see below) and do not need one.
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [254, "email must be at most 254 characters long."],
      match: [EMAIL_REGEX, "`{VALUE}` is not a valid email address."],
      validate: {
        validator: function (value) {
          return isEmployee(this.role) ? true : Boolean(value);
        },
        message: "email is required.",
      },
    },

    // Login identifier for employees, set by their merchant at creation time.
    username: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        USERNAME_REGEX,
        "username must be 3-32 characters: lowercase letters, digits, dot or underscore.",
      ],
      validate: [
        {
          validator: function (value) {
            return isEmployee(this.role) ? Boolean(value) : true;
          },
          message: "username is required for employee users.",
        },
        {
          validator: function (value) {
            return isEmployee(this.role) ? true : value == null;
          },
          message: "Only employee users may have a username.",
        },
      ],
    },

    phone: {
      type: String,
      trim: true,
      match: [PHONE_REGEX, "`{VALUE}` is not a valid phone number."],
      validate: {
        validator: function (value) {
          return isEmployee(this.role) ? Boolean(value) : true;
        },
        message: "phone is required for employee users.",
      },
    },

    password: {
      type: String,
      required: [true, "password is required."],
      minlength: [8, "password must be at least 8 characters long."],
      // Never ship the hash by default; opt in with `.select("+password")`.
      select: false,
    },

    role: {
      type: String,
      required: [true, "role is required."],
      enum: {
        values: [...USER_ROLE_VALUES],
        message: "`{VALUE}` is not a supported role.",
      },
    },

    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User", // a merchant is itself a User document
      default: null,
      validate: [
        {
          // super_admin and merchant must never reference a merchant.
          validator: function (value) {
            return isEmployee(this.role) ? true : value == null;
          },
          message: "Only employee users may reference a merchant.",
        },
        {
          // an employee must always reference a merchant.
          validator: function (value) {
            return isEmployee(this.role) ? value != null : true;
          },
          message: "merchantId is required for employee users.",
        },
      ],
    },

    // Per-employee commission rule, configured by the owning merchant.
    // Kept as a small, explicit shape (rather than a free-form object) so it
    // stays validated and easy to extend with more tiers later. Amounts are
    // whole currency units (e.g. DH) — integers only, so there is no
    // floating-point drift when they are summed/compared.
    commission: {
      type: commissionSchema,
      default: undefined,
    },

    // Per-employee Quick Livraison API key. Stored encrypted (AES-256-GCM,
    // see lib/crypto/secret-box.js) — `select: false` so it is never sent
    // over the wire by a normal query, on top of encryption at rest.
    quickLivraisonApiKey: {
      type: String,
      select: false,
    },
    // Cheap, safe-to-expose flag mirroring whether a key is configured, so
    // the UI can show "configured" without ever selecting the secret itself.
    hasQuickLivraisonApiKey: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // ACTIVE — the authoritative live counter for Ozon Express tracking
    // numbers. Was briefly superseded by the per-month TrackingCounter model
    // (see models/TrackingCounter.js), then explicitly reverted back to
    // this field as the source of truth for Ozon order creation and for the
    // CURRENT month's listing — see lib/ozon/reserve-tracking-number.js and
    // the README's "Ozon Express" section for the full history.
    // NEXT-UNUSED semantics (the stored value IS the next order's number,
    // unlike TrackingCounter's "latest used" convention); reserve/release
    // only through lib/ozon/reserve-tracking-number.js, never by writing
    // this field directly, or the concurrency-safety guarantees break.
    // Deliberately does NOT reset monthly — it is a single continuous
    // value; TrackingCounter documents from before this field was restored
    // remain in the database (untouched) and are still used, read-only, for
    // browsing PAST months' Ozon history.
    ozonTrackingCounter: {
      type: String,
      select: false,
    },
    // DORMANT — Quick Livraison still uses the per-month TrackingCounter
    // model exclusively (see lib/quick/reserve-tracking-number.js); this
    // field is not part of that and is not read or written anywhere.
    quickTrackingCounter: {
      type: String,
      select: false,
    },
  },
  {
    // adds createdAt / updatedAt and keeps them maintained.
    timestamps: true,
    toJSON: { transform: stripSensitive },
    toObject: { transform: stripSensitive },
  }
);

function stripSensitive(_doc, ret) {
  delete ret.password;
  delete ret.quickLivraisonApiKey;
  return ret;
}

/* -------------------------------------------------------------------------- */
/* Indexes — cover the common access patterns.                               */
/* -------------------------------------------------------------------------- */

// Both login identifiers are unique when present; `sparse` lets many
// documents omit the field they don't use (employees have no email, others
// have no username) without colliding on a shared `null`.
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ merchantId: 1 });
userSchema.index({ merchantId: 1, role: 1 }); // "employees of a merchant"
userSchema.index({ merchantId: 1, createdAt: -1 }); // a merchant's employee list, newest first
userSchema.index({ role: 1, isActive: 1 }); // "active users of a kind"

/* -------------------------------------------------------------------------- */
/* Referential integrity for employee.merchantId (needs a DB round-trip, so  */
/* it is an async validator rather than part of the sync rules above).       */
/* -------------------------------------------------------------------------- */

userSchema.path("merchantId").validate(async function (value) {
  if (!isEmployee(this.role) || value == null) {
    return true;
  }
  // Only pay for the lookup when the reference actually changed.
  if (typeof this.isModified === "function" && !this.isNew && !this.isModified("merchantId")) {
    return true;
  }
  const referenced = await this.constructor.exists({
    _id: value,
    role: USER_ROLES.MERCHANT,
  });
  return referenced != null;
}, "merchantId must reference an existing merchant user.");

/* -------------------------------------------------------------------------- */
/* Employees must always have a commission configuration.                    */
/* -------------------------------------------------------------------------- */

userSchema.path("commission").validate(function (value) {
  if (!isEmployee(this.role)) {
    return true;
  }
  return (
    value != null &&
    isNonNegativeInteger(value.threshold) &&
    isNonNegativeInteger(value.commissionBelowThreshold) &&
    isNonNegativeInteger(value.commissionAtOrAboveThreshold)
  );
}, "commission (threshold, commissionBelowThreshold, commissionAtOrAboveThreshold) is required for employee users.");

/* -------------------------------------------------------------------------- */
/* Password hashing — plain text must never reach the database.              */
/* -------------------------------------------------------------------------- */

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
});

// `findOneAndUpdate` / `findByIdAndUpdate` bypass the document `save` hook,
// so hash any password supplied that way too.
userSchema.pre(["findOneAndUpdate", "updateOne"], async function () {
  const update = this.getUpdate();
  if (!update) {
    return;
  }
  const target = update.$set ?? update;
  if (typeof target.password !== "string") {
    return;
  }
  target.password = await bcrypt.hash(target.password, SALT_ROUNDS);
  if (update.$set) {
    this.setUpdate({ ...update, $set: target });
  } else {
    this.setUpdate(target);
  }
});

/* -------------------------------------------------------------------------- */
/* Quick Livraison API key — encrypt at rest, mirror the password pattern:   */
/* the plain value is only ever assigned in memory, then swapped for its     */
/* encrypted form before it touches the database.                           */
/* -------------------------------------------------------------------------- */

userSchema.pre("save", function () {
  if (!this.isModified("quickLivraisonApiKey")) {
    return;
  }
  if (!this.quickLivraisonApiKey) {
    this.quickLivraisonApiKey = undefined;
    this.hasQuickLivraisonApiKey = false;
    return;
  }
  this.quickLivraisonApiKey = encryptSecret(this.quickLivraisonApiKey);
  this.hasQuickLivraisonApiKey = true;
});

/* -------------------------------------------------------------------------- */
/* Helpers.                                                                  */
/* -------------------------------------------------------------------------- */

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.statics.findByEmail = function (email, { withPassword = false } = {}) {
  const query = this.findOne({ email: String(email).trim().toLowerCase() });
  return withPassword ? query.select("+password") : query;
};

// Login lookup for the unified login form: merchants/super admins sign in
// with their email, employees with their username — same input field.
userSchema.statics.findByIdentifier = function (identifier, { withPassword = false } = {}) {
  const value = String(identifier).trim().toLowerCase();
  const query = this.findOne({ $or: [{ email: value }, { username: value }] });
  return withPassword ? query.select("+password") : query;
};

// A merchant's employees, available via `.populate("employees")`.
userSchema.virtual("employees", {
  ref: "User",
  localField: "_id",
  foreignField: "merchantId",
});

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
