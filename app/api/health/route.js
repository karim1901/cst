import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";

// Always run on request so the DB check is never statically cached.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mongoose = await connectToDatabase();

    return NextResponse.json({
      status: "ok",
      db: mongoose.connection.readyState === 1 ? "connected" : "not-connected",
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: 503 }
    );
  }
}
