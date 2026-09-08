import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { loginSchema } from "@/lib/validation/auth";
import { signSessionToken } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";
import { getCurrentUser, toPublicUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One generic message for every "bad credentials" branch so the endpoint does
// not reveal whether an account exists.
const INVALID_CREDENTIALS = "Invalid credentials.";

/**
 * Login for ALL roles (super_admin, merchant, employee). The role is read from
 * the stored User record after the password check — the client never sends it.
 */
export async function POST(request) {
  if (await getCurrentUser()) {
    return NextResponse.json(
      { error: "You are already signed in." },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const { identifier, password } = parsed.data;

  await connectToDatabase();

  // Merchants/super admins sign in with email; employees with username —
  // both flow through this one field.
  const userDoc = await User.findByIdentifier(identifier, { withPassword: true });
  if (!userDoc) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const passwordOk = await userDoc.comparePassword(password);
  if (!passwordOk) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  if (!userDoc.isActive) {
    return NextResponse.json(
      { error: "This account has been deactivated. Contact an administrator." },
      { status: 403 }
    );
  }

  const token = await signSessionToken({
    userId: userDoc._id,
    role: userDoc.role,
    merchantId: userDoc.merchantId,
  });
  await setSessionCookie(token);

  return NextResponse.json({ user: toPublicUser(userDoc) }, { status: 200 });
}
