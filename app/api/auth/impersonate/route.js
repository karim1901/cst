import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { getCurrentUser, toPublicUser } from "@/lib/auth/current-user";
import { signSessionToken } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Switch to employee" — lets a merchant view/act as one of their own
 * employees. This is a REAL session swap, not a client-side role flag: a
 * brand new, fully-privileged employee token is signed and set as the
 * session cookie, carrying an `impersonatorId` claim (the merchant's own
 * id) so `POST /api/auth/stop-impersonating` can safely hand control back
 * without ever trusting anything the client supplies. See
 * lib/auth/jwt.js's `signSessionToken` and lib/auth/current-user.js.
 *
 * The employee's password is never read, exposed, or needed for this.
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json(
      { error: "Only merchants can switch to an employee account." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const employeeId = String(body?.employeeId || "");
  if (!/^[0-9a-fA-F]{24}$/.test(employeeId)) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  await connectToDatabase();

  // Ownership + role validated together, same as every other employee
  // lookup — an id that isn't this merchant's own active employee 404s
  // exactly like one that doesn't exist, and can never be an arbitrary id.
  const employee = await User.findOne({
    _id: employeeId,
    merchantId: currentUser.id,
    role: USER_ROLES.EMPLOYEE,
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }
  if (!employee.isActive) {
    return NextResponse.json(
      { error: "This employee's account has been deactivated." },
      { status: 403 }
    );
  }

  const token = await signSessionToken({
    userId: employee._id,
    role: employee.role,
    merchantId: employee.merchantId,
    impersonatorId: currentUser.id,
  });
  await setSessionCookie(token);

  return NextResponse.json({ user: toPublicUser(employee, currentUser.id) });
}
