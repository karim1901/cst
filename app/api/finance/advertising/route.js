import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import AdvertisingExpense, { AD_SCOPE_VALUES } from "@/models/AdvertisingExpense";
import { isValidPeriod } from "@/lib/tracking/counter";
import { dhToCents, centsToDh } from "@/lib/finance/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily advertising-spend entries — Finance is a merchant-level financial
 * feature (same ownership rule as Commission/Returns/Follow-up: an
 * employee has no cross-order financial reporting to do here). Every write
 * is scoped to `currentUser.id` from the authenticated session — never a
 * client-supplied merchantId (item 22).
 */
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
    date: doc.date,
    amount: centsToDh(doc.amountCents),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** List this merchant's advertising expenses for one "YYYYMM" month. */
export async function GET(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const searchParams = new URL(request.url).searchParams;
  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : null;
  if (!period) {
    return NextResponse.json({ error: "A valid period (YYYYMM) is required." }, { status: 400 });
  }

  await connectToDatabase();

  const year = period.slice(0, 4);
  const month = period.slice(4, 6);
  const docs = await AdvertisingExpense.find({
    merchantId: currentUser.id,
    date: { $gte: `${year}-${month}-01`, $lte: `${year}-${month}-31` },
  })
    .sort({ date: -1 })
    .lean();

  return NextResponse.json({ expenses: docs.map(toSummary) });
}

/**
 * Add/update one day's advertising spend — upserts by
 * (merchantId, provider, date), matching the model's own unique index, so
 * re-entering the same day updates it instead of creating a duplicate,
 * ambiguous second entry for that day (item 2's "Add" AND "Edit" are the
 * same operation here, distinguished only by whether that date already
 * has an entry).
 */
export async function POST(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const provider = AD_SCOPE_VALUES.includes(body?.provider) ? body.provider : "all";
  const date = String(body?.date ?? "");
  const amountCents = dhToCents(body?.amount);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required." }, { status: 422 });
  }
  if (amountCents == null) {
    return NextResponse.json({ error: "A valid, non-negative amount is required." }, { status: 422 });
  }

  await connectToDatabase();

  const doc = await AdvertisingExpense.findOneAndUpdate(
    { merchantId: currentUser.id, provider, date },
    { $set: { amountCents } },
    { upsert: true, new: true }
  );

  return NextResponse.json({ expense: toSummary(doc) }, { status: 201 });
}
