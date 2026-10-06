import { z } from "zod";
import { requireVerifiedUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
import { checkout } from "@/lib/payments";
export async function POST(request: Request) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`checkout:${user.id}`, 20, 3600); const data = z.object({ bookingId: z.string().min(1).max(100), acceptedTerms: z.literal(true) }).strict().parse(await readJson(request)); return Response.json(await checkout(data.bookingId, user), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
