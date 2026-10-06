import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { currency, commissionBps, renterFeeBps, paymentsReady } from "@/lib/config";
import { dashboard } from "@/lib/marketplace";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ ...await dashboard(await requireUser()), currency, commissionBps, renterFeeBps, paymentsReady: paymentsReady() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
