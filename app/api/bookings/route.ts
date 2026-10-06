import { requireVerifiedUser } from "@/lib/auth";
import { apiError, assertSameOrigin, readJson, rateLimit } from "@/lib/http";
import { requestBooking } from "@/lib/marketplace";
export async function POST(request: Request) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`booking:${user.id}`, 20, 3600); return Response.json({ booking: await requestBooking(user, await readJson(request)) }, { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
