import { getMemberProfile } from "@/lib/features";
import { apiError, privateHeaders } from "@/lib/http";
import { currency } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ profile: await getMemberProfile((await context.params).id), currency }, { headers: privateHeaders }); }
  catch (error) { return apiError(error); }
}
