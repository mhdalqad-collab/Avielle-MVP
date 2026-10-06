import { requireUser } from "@/lib/auth";
import { getProfile, updateProfile } from "@/lib/features";
import { apiError, assertSameOrigin, privateHeaders, rateLimit, readJson } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ user: await getProfile(await requireUser()) }, { headers: privateHeaders }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`profile:${user.id}`, 30, 3600);
    return Response.json({ user: await updateProfile(user, await readJson(request)) }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
