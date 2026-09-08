import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { syncReturnsForMerchant } from "@/lib/returns/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Triggers a bounded, server-side synchronization of this merchant's
 * Ozon Express / Quick Livraison orders — see lib/returns/sync.js for
 * exactly what runs and why (and why it never touches
 * returnValidationStatus/returnValidatedAt/returnValidatedBy). Called by
 * the Returns page itself: once, lightly (`full: false`), right after it
 * loads, and again via an explicit "Sync now" button (`full: true`) — never
 * on every filter/page change, which only ever re-read the already-synced
 * local DB (see app/_components/returns/ReturnsList.jsx).
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can manage returns." }, { status: 403 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    // No body / not JSON is fine — `full` just defaults to false below.
  }
  const full = body?.full === true;

  await connectToDatabase();

  try {
    const result = await syncReturnsForMerchant(currentUser.id, { full });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/returns/sync]", err?.message);
    return NextResponse.json(
      { error: "Synchronization failed. Please try again." },
      { status: 500 }
    );
  }
}
