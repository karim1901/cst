import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import ProductCost from "@/models/ProductCost";
import { dhToCents, centsToDh } from "@/lib/finance/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireMerchant() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return { error: NextResponse.json({ error: "Only merchants can manage Finance." }, { status: 403 }) };
  }
  return { currentUser };
}

/**
 * Every distinct product name this merchant's orders have ever used
 * (`Order.productNature` — this app's existing, only product-identity
 * field; no separate product catalog is created — see
 * lib/finance/calculate.js's own comment), merged with this merchant's
 * configured cost for each (`null` where not yet configured — item 6:
 * never invented). `Order.distinct` is an indexed, targeted query — never
 * "fetch every order and dedupe in JS" (item 26).
 */
export async function GET() {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  await connectToDatabase();

  const [productNames, costDocs] = await Promise.all([
    Order.distinct("productNature", { merchantId: currentUser.id }),
    ProductCost.find({ merchantId: currentUser.id }).lean(),
  ]);

  const costByName = new Map(costDocs.map((doc) => [doc.productName.trim().toLowerCase(), doc]));

  const products = productNames
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => {
      const match = costByName.get(name.trim().toLowerCase());
      return {
        productName: name,
        costPerUnit: match ? centsToDh(match.costPerUnitCents) : null,
        configured: Boolean(match),
        id: match ? String(match._id) : null,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return NextResponse.json({ products });
}

/** Set (create or update) one product's cost per unit. */
export async function POST(request) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const productName = String(body?.productName ?? "").trim();
  const costPerUnitCents = dhToCents(body?.costPerUnit);

  if (!productName) {
    return NextResponse.json({ error: "productName is required." }, { status: 422 });
  }
  if (costPerUnitCents == null) {
    return NextResponse.json({ error: "A valid, non-negative cost is required." }, { status: 422 });
  }

  await connectToDatabase();

  const doc = await ProductCost.findOneAndUpdate(
    { merchantId: currentUser.id, productName },
    { $set: { costPerUnitCents } },
    { upsert: true, new: true, collation: { locale: "en", strength: 1 } }
  );

  return NextResponse.json(
    {
      product: {
        id: String(doc._id),
        productName: doc.productName,
        costPerUnit: centsToDh(doc.costPerUnitCents),
        configured: true,
      },
    },
    { status: 201 }
  );
}
