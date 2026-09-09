import mongoose from "mongoose";

import { AD_SCOPE_VALUES } from "./AdvertisingExpense.js";

const { Schema } = mongoose;

/**
 * A business-level expense that is not advertising and not tied to a
 * single order (packaging, rent, staff, software, ...) — see item 7/19 of
 * the Finance spec. Deducted ONCE from the relevant month's total profit
 * (lib/finance/calculate.js#calculateMonthlyFinancials), never multiplied
 * per order — a per-order "allocated share" is a DISPLAY-only estimate
 * computed the same documented way advertising is (divide by that day's
 * order count), never a second real expense.
 */
const otherExpenseSchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "merchantId is required."],
    },
    title: {
      type: String,
      required: [true, "title is required."],
      trim: true,
      maxlength: [200, "Title must be at most 200 characters long."],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [2000, "Description must be at most 2000 characters long."],
    },
    category: {
      type: String,
      trim: true,
      default: "",
      maxlength: [100, "Category must be at most 100 characters long."],
    },
    // Same "all" | one specific provider scope as AdvertisingExpense — an
    // expense genuinely tied to one provider's operations (e.g. that
    // provider's packaging) can be scoped to it; most business expenses are
    // "all" by default.
    provider: {
      type: String,
      enum: {
        values: [...AD_SCOPE_VALUES],
        message: "`{VALUE}` is not a valid expense scope.",
      },
      default: "all",
    },
    // "YYYY-MM-DD" — same local-date convention as AdvertisingExpense.
    date: {
      type: String,
      required: [true, "date is required."],
      match: [/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format."],
    },
    // Integer centimes — see lib/finance/money.js.
    amountCents: {
      type: Number,
      required: [true, "amountCents is required."],
      min: [0, "amountCents must be 0 or greater."],
    },
  },
  { timestamps: true }
);

otherExpenseSchema.index({ merchantId: 1, date: -1 });

const OtherExpense = mongoose.models.OtherExpense || mongoose.model("OtherExpense", otherExpenseSchema);

export default OtherExpense;
