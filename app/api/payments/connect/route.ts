import { requireVerifiedUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit } from "@/lib/http";
import { connect, syncConnect } from "@/lib/payments";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { assertSameOrigin(request); const user = await requireVerifiedUser(); await rateLimit(`connect:${user.id}`, 10, 3600); return Response.json(await connect(user), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function GET() {
  try { const user = await requireVerifiedUser(); await rateLimit(`connect-sync:${user.id}`, 30, 3600); return Response.json(await syncConnect(user), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
