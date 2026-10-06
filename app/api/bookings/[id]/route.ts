import { requireUser, requireVerifiedUser } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson, rateLimit } from "@/lib/http";
import { bookingAction, getBooking } from "@/lib/marketplace";
import { cancelPayment, settlePayment } from "@/lib/payments";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ booking: await getBooking((await context.params).id, await requireUser()) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireVerifiedUser(); const { id } = await context.params;
    await rateLimit(`booking-action:${user.id}`, 120, 3600);
    const result = await bookingAction(id, user, await readJson(request));
    if (result.paymentWork === "cancel") await cancelPayment(id);
    if (result.paymentWork === "settle") await settlePayment(id);
    return Response.json({ booking: await getBooking(id, user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
