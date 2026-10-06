import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "./db";
import { hashToken, newToken } from "./password";
import { HttpError } from "./http";
const cookieName = process.env.NODE_ENV === "production" ? "__Host-avielle-session" : "avielle-session";
export function safeUser(u: User) {
  return {id:u.id,name:u.name,email:u.email,role:u.role,emailVerifiedAt:u.emailVerifiedAt,payoutsEnabled:u.payoutsEnabled};
}
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({where:{tokenHash:hashToken(token)},include:{user:true}});
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401,"Please sign in to continue.");
  return user;
}
export async function requireVerifiedUser() {
  const user = await requireUser();
  if (!user.emailVerifiedAt) throw new HttpError(403,"Please verify your email before listing or requesting a rental.");
  return user;
}
export async function createSession(userId: string) {
  const token = newToken(), expiresAt = new Date(Date.now()+30*86400_000);
  await db.session.create({data:{tokenHash:hashToken(token),userId,expiresAt}});
  (await cookies()).set(cookieName,token,{httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax",path:"/",expires:expiresAt});
}
export async function destroySession() {
  const jar = await cookies(), token=jar.get(cookieName)?.value;
  if (token) await db.session.deleteMany({where:{tokenHash:hashToken(token)}});
  jar.set(cookieName,"",{httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax",path:"/",maxAge:0});
}
