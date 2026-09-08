import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import ShippingCompany from "@/models/ShippingCompany";
import { USER_ROLES } from "@/models/User";
import { shippingCompanySchema } from "@/lib/validation/shipping-companies";
import { fieldErrorsOf } from "@/lib/validation/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  listShippingCompaniesForMerchant,
  toShippingCompanySummary,
} from "@/lib/shipping-companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shipping-company configuration belongs to the merchant that owns it — the
 * same ownership model as employees. Every query and write below is scoped
 * to `currentUser.id`, so one merchant can never see or change another
 * merchant's provider credentials, and neither an employee nor a super admin
 * can manage them.
 */
function requireMerchant(currentUser) {
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json(
      { error: "Only merchants can manage shipping company settings." },
      { status: 403 }
    );
  }
  return null;
}

/** The authenticated merchant's configured shipping companies. */
export async function GET() {
  const currentUser = await getCurrentUser();
  const denied = requireMerchant(currentUser);
  if (denied) return denied;

  const shippingCompanies = await listShippingCompaniesForMerchant(currentUser.id);
  return NextResponse.json({ shippingCompanies });
}

/**
 * Create or update ONE provider's configuration for the authenticated
 * merchant ("upsert" by `merchantId` + `provider`, so saving an
 * already-configured provider updates the existing document instead of
 * creating a duplicate). `apiKey` is optional on the wire — omitting it
 * keeps the currently-stored key — but required the first time a provider
 * is configured.
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();
  const denied = requireMerchant(currentUser);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = shippingCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please correct the highlighted fields.",
        fieldErrors: fieldErrorsOf(parsed.error),
      },
      { status: 422 }
    );
  }

  const { provider, apiKey, ...rest } = parsed.data;

  await connectToDatabase();

  // Select `apiKeyLast4` (safe — 4 characters) so the response can still show
  // the masked hint even when this update doesn't touch `apiKey` itself.
  let doc = await ShippingCompany.findOne({ merchantId: currentUser.id, provider }).select(
    "+apiKeyLast4"
  );

  if (!doc && !apiKey) {
    return NextResponse.json(
      {
        error: "Please correct the highlighted fields.",
        fieldErrors: { apiKey: ["API key is required."] },
      },
      { status: 422 }
    );
  }

  if (doc) {
    doc.set(rest); // e.g. ozonId
    if (apiKey) {
      doc.apiKey = apiKey; // only touch it (and re-encrypt) when a new one was sent
    }
  } else {
    doc = new ShippingCompany({
      provider,
      ...rest,
      apiKey,
      merchantId: currentUser.id, // always the authenticated merchant — never from the client
    });
  }

  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) {
      return NextResponse.json(
        { error: "This provider is already configured." },
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

  return NextResponse.json(
    { shippingCompany: toShippingCompanySummary(doc) },
    { status: 200 }
  );
}
