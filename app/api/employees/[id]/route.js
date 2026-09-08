import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import { employeeUpdateSchema, fieldErrorsOf } from "@/lib/validation/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { toEmployeeSummary } from "@/lib/employees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUPLICATE_USERNAME = "This username is already taken.";

/**
 * One employee, scoped to the authenticated merchant — same ownership rule
 * as everywhere else (`merchantId: currentUser.id`). Looking up by
 * `{_id, merchantId}` together (rather than `_id` then a separate ownership
 * check) means an id belonging to another merchant's employee 404s exactly
 * like one that doesn't exist at all — it never reveals whether the id is
 * merely "not yours" vs. "doesn't exist".
 */
async function loadOwnedEmployee(id, merchantId) {
  if (!id || typeof id !== "string" || !/^[0-9a-fA-F]{24}$/.test(id)) {
    return null;
  }
  return User.findOne({ _id: id, merchantId, role: USER_ROLES.EMPLOYEE }).select(
    "+ozonTrackingCounter"
  );
}

async function requireMerchant() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return {
      error: NextResponse.json({ error: "Only merchants can manage employees." }, { status: 403 }),
    };
  }
  return { currentUser };
}

/** One employee's full editable data, including the real `ozonTrackingCounter` value. */
export async function GET(request, { params }) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const { id } = await params;
  await connectToDatabase();

  const employee = await loadOwnedEmployee(id, currentUser.id);
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  return NextResponse.json({
    employee: {
      ...toEmployeeSummary(employee),
      ozonTrackingCounter: employee.ozonTrackingCounter ?? null,
    },
  });
}

/**
 * Partial update of one employee. Every field is optional — only what the
 * merchant actually submits changes. Loads the document and calls
 * `.save()` (rather than `findOneAndUpdate`) so the model's existing
 * `pre('save')` hooks fire exactly as they do at creation: password
 * re-hashing, Quick Livraison API key encryption. No parallel update path,
 * no new business logic — this only reaches fields the model already
 * defines.
 */
export async function PATCH(request, { params }) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const { id } = await params;
  await connectToDatabase();

  const employee = await loadOwnedEmployee(id, currentUser.id);
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = employeeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
      { status: 422 }
    );
  }

  const { name, username, phone, password, commission, quickLivraisonApiKey, ozonTrackingCounter } =
    parsed.data;

  if (name !== undefined) employee.name = name;
  if (username !== undefined) employee.username = username;
  if (phone !== undefined) employee.phone = phone;
  if (password !== undefined) employee.password = password; // re-hashed by pre('save')
  if (commission !== undefined) employee.commission = commission;
  if (quickLivraisonApiKey !== undefined) employee.quickLivraisonApiKey = quickLivraisonApiKey;
  // Administrative override of the live, authoritative counter — see
  // lib/ozon/reserve-tracking-number.js. Writing it directly here (rather
  // than through reserveNextOzonTrackingNumber's CAS loop) is intentional:
  // this is a merchant correcting the value, not reserving one for an
  // order. It stays the one and only counter field either way.
  if (ozonTrackingCounter !== undefined) {
    employee.ozonTrackingCounter = String(ozonTrackingCounter);
  }

  try {
    await employee.save();
  } catch (err) {
    if (err?.code === 11000) {
      // Same defensive field-inspection as employee creation — see
      // app/api/employees/route.js's POST for why this must never blindly
      // assume the conflict was on username.
      const conflictField = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0];
      if (conflictField === "username") {
        return NextResponse.json({ error: DUPLICATE_USERNAME }, { status: 409 });
      }
      console.error(
        "[PATCH /api/employees/:id] unexpected duplicate key on field:",
        conflictField
      );
      return NextResponse.json(
        { error: "Could not save changes due to a conflicting value. Please try again." },
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

  return NextResponse.json({
    employee: {
      ...toEmployeeSummary(employee),
      ozonTrackingCounter: employee.ozonTrackingCounter ?? null,
    },
  });
}
