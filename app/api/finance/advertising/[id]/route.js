import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import AdvertisingExpense from "@/models/AdvertisingExpense";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete one advertising-expense entry — ownership-scoped (`merchantId`
 * from the session, never trusted from the URL/body), so one merchant can
 * never delete another's entry even by guessing an id (item 22). */
export async function DELETE(request, { params }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can manage Finance." }, { status: 403 });
  }

  const { id } = await params;
  await connectToDatabase();

  const result = await AdvertisingExpense.deleteOne({ _id: id, merchantId: currentUser.id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
