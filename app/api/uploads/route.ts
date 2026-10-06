import sharp from "sharp";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireVerifiedUser } from "@/lib/auth";
import { apiError,assertSameOrigin,HttpError,rateLimit,readBody,privateHeaders } from "@/lib/http";
import { storeImage,removeImage } from "@/lib/storage";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const user=await requireVerifiedUser();
    await rateLimit(`upload:${user.id}`,30,3600);
    const count=await db.upload.count({where:{ownerId:user.id}});
    if(count>=300) throw new HttpError(400,"Your photo allowance is full. Please contact support.");
    const bytes=await readBody(request,6*1024*1024);
    const form=await new Response(bytes,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const file=form.get("file"),purpose=z.enum(["LISTING","EVIDENCE"]).parse(form.get("purpose"));
    let bookingId:string|undefined;
    if(purpose==="EVIDENCE") {
      bookingId=z.string().min(1).max(100).parse(form.get("bookingId"));
      const booking=await db.booking.findUnique({where:{id:bookingId},include:{listing:{select:{ownerId:true}}}});
      if(!booking || (booking.renterId!==user.id && booking.listing.ownerId!==user.id)) throw new HttpError(404,"Rental not found.");
    }
    if(!(file instanceof File) || !["image/jpeg","image/png","image/webp"].includes(file.type) || file.size>5*1024*1024 || !file.size) throw new HttpError(400,"Choose a JPEG, PNG or WebP photo up to 5 MB.");
    let image:Buffer;
    try {
      const source=Buffer.from(await file.arrayBuffer());
      const decoded=sharp(source,{limitInputPixels:20_000_000,animated:false});
      const info=await decoded.metadata();
      if(!info.format || !["jpeg","png","webp"].includes(info.format)) throw new Error("Unsupported image");
      image=await decoded.rotate().resize({width:2000,height:2000,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
    } catch {throw new HttpError(400,"This photo cannot be read. Choose a valid JPEG, PNG or WebP file.");}
    const key=await storeImage(image);
    try {
      const upload=await db.upload.create({data:{ownerId:user.id,key,mimeType:"image/webp",bytes:image.length,purpose,bookingId}});
      return Response.json({url:`/api/media/${upload.id}`,id:upload.id},{status:201,headers:privateHeaders});
    } catch(e) {await removeImage(key).catch(()=>{});throw e;}
  } catch(e){return apiError(e);}
}
