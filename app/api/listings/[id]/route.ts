import { currentUser, requireVerifiedUser } from "@/lib/auth";
import { currency, commissionBps, renterFeeBps, paymentsReady } from "@/lib/config";
import { apiError, assertSameOrigin, readJson, rateLimit } from "@/lib/http";
import { getListing, updateListing } from "@/lib/marketplace";
import { deleteListing } from "@/lib/features";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ ...await getListing((await context.params).id, await currentUser()), currency, commissionBps, renterFeeBps, paymentsReady: paymentsReady() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`listing-update:${user.id}`, 60, 3600); return Response.json({ listing: await updateListing((await context.params).id, user, await readJson(request)) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`listing-delete:${user.id}`, 30, 3600); return Response.json({ listing: await deleteListing((await context.params).id, user) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
