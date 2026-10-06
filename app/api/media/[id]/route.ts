import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { apiError,HttpError } from "@/lib/http";
import { fetchImage } from "@/lib/storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params;
    const upload=await db.upload.findUnique({where:{id}});
    if(!upload) throw new HttpError(404,"Photo not found.");
    const user=await currentUser(),url=`/api/media/${id}`;
    let allowed=user?.id===upload.ownerId || user?.role==="ADMIN";
    if(!allowed && upload.purpose==="LISTING") {
      const listing=await db.listing.findFirst({where:{images:{has:url},OR:[{status:"ACTIVE",owner:{active:true}},...(user?[{bookings:{some:{renterId:user.id}}}]:[])]},select:{id:true}});
      allowed=Boolean(listing);
    }
    if(!allowed && user && upload.purpose==="EVIDENCE" && upload.bookingId) {
      allowed=Boolean(await db.booking.findFirst({where:{id:upload.bookingId,OR:[{renterId:user.id},{listing:{ownerId:user.id}}]},select:{id:true}}));
    }
    if(!allowed) throw new HttpError(404,"Photo not found.");
    const image=await fetchImage(upload.key);
    return new Response(new Uint8Array(image),{headers:{"Content-Type":"image/webp","Content-Length":String(image.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch(e){return apiError(e);}
}
