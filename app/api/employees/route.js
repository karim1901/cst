import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { employeeCreateSchema, fieldErrorsOf } from "@/lib/validation/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listEmployeesForMerchant, toEmployeeSummary } from "@/lib/employees";
import { syncHistoricalOzonOrders } from "@/lib/commission/sync-historical-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUPLICATE_USERNAME = "This username is already taken.";

/**
 * List the authenticated merchant's own employees. Always scoped to
 * `merchantId: currentUser.id` — there is no way to pass another merchant's
 * id in, so this can never leak another merchant's employees.
 */
export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json(
      { error: "Only merchants can view their employees." },
      { status: 403 }
    );
  }

  const employees = await listEmployeesForMerchant(currentUser.id);
  return NextResponse.json({ employees });
}

/**
 * Create an employee for the authenticated merchant.
 *
 *  - Caller must be an authenticated MERCHANT.
 *  - `role` is forced to "employee".
 *  - `merchantId` is forced to the caller's own id — the client cannot pick
 *    another merchant, and cannot create a super admin.
 *  - Login is by `username` (not email) — see `models/User.js`.
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json(
      { error: "Only merchants can create employees." },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = employeeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please correct the highlighted fields.",
        fieldErrors: fieldErrorsOf(parsed.error),
      },
      { status: 422 }
    );
  }

  const { name, username, phone, password, commission, quickLivraisonApiKey } = parsed.data;

  await connectToDatabase();

  if (await User.exists({ username })) {
    return NextResponse.json({ error: DUPLICATE_USERNAME }, { status: 409 });
  }

  let employee;
  try {
    employee = await User.create({
      name,
      username,
      phone,
      password,
      commission, // { threshold, commissionBelowThreshold, commissionAtOrAboveThreshold }
      quickLivraisonApiKey, // encrypted by the model's pre-save hook; undefined if omitted
      role: USER_ROLES.EMPLOYEE, // enforced server-side
      merchantId: currentUser.id, // always the authenticated merchant — never from the client
    });
  } catch (err) {
    if (err?.code === 11000) {
      // A duplicate-key error can come from ANY unique index on this
      // collection (username, email, ...) — inspect which field actually
      // conflicted instead of assuming it was username. `keyPattern` is set
      // by the MongoDB driver on the raw error Mongoose re-throws for
      // `.create()`; `keyValue` is a defensive fallback in case a future
      // driver/version only sets that one.
      const conflictField = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0];
      if (conflictField === "username") {
        return NextResponse.json({ error: DUPLICATE_USERNAME }, { status: 409 });
      }
      console.error(
        "[POST /api/employees] unexpected duplicate key on field:",
        conflictField,
        "- this points at a unique index other than username (e.g. a stale/misconfigured one); it must never be reported to the user as a username conflict."
      );
      return NextResponse.json(
        { error: "Could not create the employee due to a conflicting value. Please try again or contact support." },
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

  // Fire-and-forget, never awaited: a brand-new employee may already have
  // real, delivered Ozon orders that predate joining cst (created directly
  // at Ozon or through an older tool) — see
  // lib/commission/sync-historical-orders.js's module comment for why
  // those would otherwise be permanently invisible to commission. This
  // never blocks or can fail the employee-creation response; any error is
  // only ever logged. Runs generically for every new employee — nothing
  // here is specific to any one username.
  syncHistoricalOzonOrders(String(employee._id)).catch((err) => {
    console.error(
      "[POST /api/employees] historical Ozon sync failed for",
      employee.username,
      "-",
      err?.message
    );
  });

  return NextResponse.json({ employee: toEmployeeSummary(employee) }, { status: 201 });
}
