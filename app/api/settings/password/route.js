import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { passwordChangeSchema, fieldErrorsOf } from "@/lib/validation/auth";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID_CURRENT_PASSWORD = "The current password you entered is incorrect.";

/**
 * Self-service password change, every role. Requires the current password
 * (re-verified against a freshly `.select("+password")`-loaded document —
 * never trusts the session alone for this), then assigns the new one and
 * calls `.save()` so the model's existing `pre('save')` re-hash hook does
 * the actual hashing — no parallel hashing path. Never logs either
 * password, and the response body never carries the hash (the model's
 * `toJSON` transform already strips it from every other response; this
 * route doesn't echo the user object at all, to be doubly sure).
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = passwordChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
      { status: 422 }
    );
  }

  await connectToDatabase();
  const doc = await User.findById(currentUser.id).select("+password");
  if (!doc) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const { currentPassword, newPassword } = parsed.data;
  const currentOk = await doc.comparePassword(currentPassword);
  if (!currentOk) {
    return NextResponse.json({ error: INVALID_CURRENT_PASSWORD }, { status: 401 });
  }

  doc.password = newPassword;
  await doc.save();

  return NextResponse.json({ ok: true });
}
