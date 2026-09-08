import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { merchantRegisterSchema, fieldErrorsOf } from "@/lib/validation/auth";
import { signSessionToken } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";
import { getCurrentUser, toPublicUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public registration — MERCHANTS ONLY.
 *
 * `role` is hard-coded to "merchant" here and is not part of the accepted
 * schema, so a client can never register as `super_admin` or `employee`
 * regardless of what it sends.
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

  const parsed = merchantRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please correct the highlighted fields.",
        fieldErrors: fieldErrorsOf(parsed.error),
      },
      { status: 422 }
    );
  }

  const { name, email, password } = parsed.data;

  await connectToDatabase();

  if (await User.exists({ email })) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  let userDoc;
  try {
    userDoc = await User.create({
      name,
      email,
      password,
      role: USER_ROLES.MERCHANT, // enforced server-side
    });
  } catch (err) {
    if (err?.code === 11000) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    if (err?.name === "ValidationError") {
      return NextResponse.json(
        { error: "Please correct the highlighted fields." },
        { status: 422 }
      );
    }
    throw err;
  }

  // Registration signs the merchant straight in.
  const token = await signSessionToken({
    userId: userDoc._id,
    role: userDoc.role,
    merchantId: null,
  });
  await setSessionCookie(token);

  return NextResponse.json({ user: toPublicUser(userDoc) }, { status: 201 });
}
