import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import OtherExpense from "@/models/OtherExpense";
import { AD_SCOPE_VALUES } from "@/models/AdvertisingExpense";
import { dhToCents, centsToDh } from "@/lib/finance/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwned(id, merchantId) {
  const doc = await OtherExpense.findOne({ _id: id, merchantId });
  return doc;
}

/** Edit one other-expense entry — ownership-scoped. */
export async function PATCH(request, { params }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can manage Finance." }, { status: 403 });
  }

  const { id } = await params;
  await connectToDatabase();

  const doc = await requireOwned(id, currentUser.id);
  if (!doc) return NextResponse.json({ error: "Expense not found." }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body?.title !== undefined) doc.title = String(body.title).trim();
  if (body?.description !== undefined) doc.description = String(body.description).trim().slice(0, 2000);
  if (body?.category !== undefined) doc.category = String(body.category).trim().slice(0, 100);
  if (body?.provider !== undefined && AD_SCOPE_VALUES.includes(body.provider)) doc.provider = body.provider;
  if (body?.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) doc.date = body.date;
  if (body?.amount !== undefined) {
    const amountCents = dhToCents(body.amount);
    if (amountCents == null) {
      return NextResponse.json({ error: "A valid, non-negative amount is required." }, { status: 422 });
    }
    doc.amountCents = amountCents;
  }

  await doc.save();

  return NextResponse.json({
    expense: {
      id: String(doc._id),
      title: doc.title,
      description: doc.description,
      category: doc.category,
      provider: doc.provider,
      date: doc.date,
      amount: centsToDh(doc.amountCents),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
  });
}

/** Delete one other-expense entry — ownership-scoped. */
export async function DELETE(request, { params }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can manage Finance." }, { status: 403 });
  }

  const { id } = await params;
  await connectToDatabase();

  const result = await OtherExpense.deleteOne({ _id: id, merchantId: currentUser.id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
