import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { profileUpdateSchema, fieldErrorsOf } from "@/lib/validation/auth";
import { getCurrentUser, toPublicUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUPLICATE_USERNAME = "This username is already taken.";
const DUPLICATE_EMAIL = "This email is already in use.";

/**
 * Self-service profile edit — every role uses this one route. The target
 * is always `getCurrentUser()`'s own id; there is no way to pass another
 * user's id in. Which submitted fields actually apply is decided here from
 * the caller's own role, never from anything the client claims about
 * itself: an employee can never set `email` (they don't have one), and a
 * merchant/super admin can never set `username` (same rule the model
 * itself already enforces — see models/User.js).
 */
export async function PATCH(request) {
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

  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
      { status: 422 }
    );
  }

  await connectToDatabase();
  const doc = await User.findById(currentUser.id);
  if (!doc) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const { name, phone, username, email } = parsed.data;
  const isEmployee = doc.role === USER_ROLES.EMPLOYEE;

  if (name !== undefined) doc.name = name;
  if (phone !== undefined) doc.phone = phone;
  // Login identifier fields — only the one this role actually has.
  if (isEmployee) {
    if (username !== undefined) doc.username = username;
  } else if (email !== undefined) {
    doc.email = email;
  }

  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) {
      const conflictField = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0];
      if (conflictField === "username") {
        return NextResponse.json({ error: DUPLICATE_USERNAME }, { status: 409 });
      }
      if (conflictField === "email") {
        return NextResponse.json({ error: DUPLICATE_EMAIL }, { status: 409 });
      }
      console.error("[PATCH /api/settings/profile] unexpected duplicate key on field:", conflictField);
      return NextResponse.json(
        { error: "Could not save changes due to a conflicting value. Please try again." },
        { status: 409 }
      );
    }
    if (err?.name === "ValidationError") {
      return NextResponse.json({ error: "Please correct the highlighted fields." }, { status: 422 });
    }
    throw err;
  }

  return NextResponse.json({ user: toPublicUser(doc, currentUser.impersonatorId) });
}
