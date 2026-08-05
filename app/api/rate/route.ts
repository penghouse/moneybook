import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { requireUserId } from "@/lib/current-user";
import { getOrFetchRate, RateUnavailableError } from "@/lib/exchange-rates";

// Used by the client-side entry form to live-compute a split
// transaction's base-currency total as the user picks a foreign
// currency, without a full form submission round trip.
export async function GET(request: NextRequest) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const base = searchParams.get("base");
  const quote = searchParams.get("quote");

  if (!date || !base || !quote) {
    return NextResponse.json({ error: "missing date/base/quote" }, { status: 400 });
  }

  try {
    const result = await getOrFetchRate(db, { date, base, quote });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RateUnavailableError) {
      return NextResponse.json({ error: "rate_unavailable" }, { status: 404 });
    }
    throw error;
  }
}
