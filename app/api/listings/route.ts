import { requireVerifiedUser } from "@/lib/auth";
import { currency, commissionBps, renterFeeBps, paymentsReady } from "@/lib/config";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
import { createListing, getListings } from "@/lib/marketplace";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json({ listings: await getListings(new URL(request.url).searchParams), currency, commissionBps, renterFeeBps, paymentsReady: paymentsReady() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`listing:${user.id}`, 15, 3600); return Response.json({ listing: await createListing(user, await readJson(request)) }, { status: 201 }); } catch (error) { return apiError(error); }
}
