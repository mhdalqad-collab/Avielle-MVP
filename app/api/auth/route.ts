import { z } from "zod";
import { db } from "@/lib/db";
import { createSession,currentUser,destroySession,requireUser,safeUser } from "@/lib/auth";
import { apiError,assertSameOrigin,HttpError,privateHeaders,rateLimit,readJson } from "@/lib/http";
import { hashPassword,hashToken,newToken,verifyPassword } from "@/lib/password";
import { sendMail } from "@/lib/mail";
import { appUrl,mailReady } from "@/lib/config";
export const dynamic="force-dynamic";
const emailSchema=z.string().trim().email().max(254).transform(s=>s.toLowerCase());
const passwordSchema=z.string().min(12,"Use at least 12 characters.").max(128);
const schema=z.object({action:z.enum(["register","login","logout","forgot","reset","verify","resend"]),email:emailSchema.optional(),password:z.string().max(128).optional(),name:z.string().trim().min(2).max(80).optional(),token:z.string().max(128).optional()}).strict();
const dummyHash="scrypt:ab41043fc8a922cf582ad7cc124e2cae:ac254f593abc30b998335f30c361917e3abbf5a4e71d7a351604e7148e876a3fec4788d4081951b161066619dbe618639ef5f9a0ac2d548aa252e4bf77685b279";
async function emailToken(userId:string,email:string,purpose:"VERIFY"|"RESET") {
  const token=newToken();
  await db.authToken.create({data:{userId,tokenHash:hashToken(token),purpose,expiresAt:new Date(Date.now()+(purpose==="RESET"?3600_000:86400_000))}});
  const path=purpose==="RESET"?"reset-password":"verify-email";
  await sendMail(email,purpose==="RESET"?"Reset your Avielle password":"Verify your Avielle email",`${purpose==="RESET"?"Reset your password":"Verify your email"}: ${appUrl()}/${path}?token=${token}\n\nThis link expires ${purpose==="RESET"?"in one hour":"in 24 hours"}. If you didn't request it, you can ignore this email.`);
}
export async function GET() {
  try { const user=await currentUser(); return Response.json({user:user?safeUser(user):null},{headers:privateHeaders}); } catch(e) {return apiError(e);}
}
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const data=schema.parse(await readJson(request));
    // A global cap also limits random-address signup abuse without trusting spoofable forwarded headers.
    await rateLimit("auth:global",300,60);
    if (data.action==="logout") {await destroySession(); return Response.json({ok:true},{headers:privateHeaders});}
    if (data.action==="register") {
      const input=z.object({email:emailSchema,password:passwordSchema,name:z.string().trim().min(2).max(80)}).parse(data);
      await rateLimit(`register:${input.email}`,3,3600);
      if (!mailReady()) throw new HttpError(503,"Account registration will open when email delivery is connected.");
      const exists=await db.user.findUnique({where:{email:input.email}});
      if (!exists) {
        const user=await db.user.create({data:{email:input.email,name:input.name,passwordHash:await hashPassword(input.password)}});
        await emailToken(user.id,user.email,"VERIFY");
        await createSession(user.id);
      }
      return Response.json({ok:true,message:"Check your inbox to verify your email. If you already have an account, sign in or reset your password."},{headers:privateHeaders});
    }
    if (data.action==="login") {
      const email=emailSchema.parse(data.email),password=z.string().min(1).max(128).parse(data.password);
      await rateLimit(`login:${email}`,10,900);
      const user=await db.user.findUnique({where:{email}});
      const valid=await verifyPassword(password,user?.passwordHash||dummyHash);
      if (!valid || !user || !user.active) throw new HttpError(401,"Email or password is incorrect.");
      await destroySession(); await createSession(user.id);
      return Response.json({user:safeUser(user)},{headers:privateHeaders});
    }
    if (data.action==="forgot") {
      const email=emailSchema.parse(data.email);
      await rateLimit(`forgot:${email}`,3,3600);
      if (!mailReady()) throw new HttpError(503,"Email delivery is temporarily unavailable.");
      const user=await db.user.findUnique({where:{email}});
      if (user?.active) await emailToken(user.id,user.email,"RESET");
      return Response.json({ok:true,message:"If an account matches that email, a password reset link is on its way."},{headers:privateHeaders});
    }
    if (data.action==="resend") {
      const user=await requireUser();
      await rateLimit(`resend:${user.id}`,3,3600);
      if (!user.emailVerifiedAt) await emailToken(user.id,user.email,"VERIFY");
      return Response.json({ok:true,message:"Check your inbox for your verification link."},{headers:privateHeaders});
    }
    const tokenHash=hashToken(z.string().min(32).max(128).parse(data.token));
    await rateLimit(`token:${tokenHash}`,5,3600);
    const purpose=data.action==="reset"?"RESET":"VERIFY";
    const passwordHash=purpose==="RESET"?await hashPassword(passwordSchema.parse(data.password)):undefined;
    const userId=await db.$transaction(async tx=>{
      const token=await tx.authToken.findUnique({where:{tokenHash}});
      if (!token || token.purpose!==purpose || token.expiresAt<new Date()) throw new HttpError(400,"This link is invalid or expired. Request a new one.");
      const consumed=await tx.authToken.deleteMany({where:{tokenHash,purpose,expiresAt:{gt:new Date()}}});
      if (!consumed.count) throw new HttpError(400,"This link has already been used.");
      await tx.user.update({where:{id:token.userId},data:purpose==="RESET"?{passwordHash}:{emailVerifiedAt:new Date()}});
      await tx.authToken.deleteMany({where:{userId:token.userId,purpose}});
      if (purpose==="RESET") await tx.session.deleteMany({where:{userId:token.userId}});
      return token.userId;
    });
    if (purpose==="RESET") await destroySession();
    return Response.json({ok:true,message:purpose==="RESET"?"Your password has been changed. Sign in with your new password.":"Your email is verified. You can now list and request pieces."},{headers:privateHeaders});
  } catch(e) {return apiError(e);}
}
