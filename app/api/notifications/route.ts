import { requireUser } from "@/lib/auth";
import { getNotifications, markNotificationsRead } from "@/lib/notifications";
import { apiError, assertSameOrigin, privateHeaders, rateLimit, readJson } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await getNotifications((await requireUser()).id), { headers: privateHeaders }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`notifications:${user.id}`, 120, 3600);
    return Response.json(await markNotificationsRead(user.id, await readJson(request)), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
