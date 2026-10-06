import { db } from "../lib/db";
import { hashPassword } from "../lib/password";
import { z } from "zod";
async function main() {
  const input=z.object({email:z.string().email().transform(s=>s.toLowerCase()),name:z.string().min(2),password:z.string().min(16).max(128)}).parse({email:process.env.ADMIN_EMAIL,name:process.env.ADMIN_NAME,password:process.env.ADMIN_PASSWORD});
  const exists=await db.user.findUnique({where:{email:input.email}});
  if(exists) throw new Error("Account already exists. Grant its admin role through your controlled database console; this command never resets existing accounts.");
  await db.user.create({data:{email:input.email,name:input.name,passwordHash:await hashPassword(input.password),role:"ADMIN",emailVerifiedAt:new Date()}});
  console.log("Administrator created. Remove ADMIN_PASSWORD from the environment after this command.");
}
main().catch(e=>{console.error(e instanceof z.ZodError?"Set ADMIN_EMAIL, ADMIN_NAME, and a password of at least 16 characters in ADMIN_PASSWORD.":e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
