import { currentUser, requireVerifiedUser } from "@/lib/auth";
import { addAvailabilityBlock, getAvailability, removeAvailabilityBlock } from "@/lib/features";
import { apiError, assertSameOrigin, privateHeaders, rateLimit, readJson } from "@/lib/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json(await getAvailability((await context.params).id, await currentUser()), { headers: privateHeaders }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireVerifiedUser();
    await rateLimit(`availability:${user.id}`, 120, 3600);
    const id = (await context.params).id;
    const block = await addAvailabilityBlock(id, user, await readJson(request));
    return Response.json({ block, ...await getAvailability(id, user) }, { status: 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireVerifiedUser();
    await rateLimit(`availability:${user.id}`, 120, 3600);
    const id = (await context.params).id;
    await removeAvailabilityBlock(id, user, new URL(request.url).searchParams.get("blockId") ?? "");
    return Response.json({ ok: true, ...await getAvailability(id, user) }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
