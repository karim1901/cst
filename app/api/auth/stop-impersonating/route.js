import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { getCurrentUser, toPublicUser } from "@/lib/auth/current-user";
import { signSessionToken } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Return to merchant" — the other half of impersonate/route.js. Trusts
 * only `currentUser.impersonatorId`, which `getCurrentUser()` reads from
 * the CURRENT, cryptographically-verified session token (see
 * lib/auth/current-user.js) — never a client-supplied merchant id, so this
 * can never be used to jump into an arbitrary account.
 */
export async function POST() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!currentUser.impersonatorId) {
    return NextResponse.json(
      { error: "You are not currently viewing the app as an employee." },
      { status: 400 }
    );
  }

  await connectToDatabase();

  const merchant = await User.findOne({
    _id: currentUser.impersonatorId,
    role: USER_ROLES.MERCHANT,
  });
  if (!merchant || !merchant.isActive) {
    return NextResponse.json(
      { error: "The original merchant account is no longer available." },
      { status: 409 }
    );
  }

  const token = await signSessionToken({
    userId: merchant._id,
    role: merchant.role,
    merchantId: null,
    impersonatorId: null,
  });
  await setSessionCookie(token);

  return NextResponse.json({ user: toPublicUser(merchant) });
}
