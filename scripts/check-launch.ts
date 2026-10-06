import { db } from "../lib/db";
const issues:string[]=[];
for(const key of ["DATABASE_URL","APP_URL","STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","RESEND_API_KEY","EMAIL_FROM","S3_BUCKET","S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY","NEXT_PUBLIC_SUPPORT_EMAIL","NEXT_PUBLIC_TERMS_URL","NEXT_PUBLIC_PRIVACY_URL"]) if(!process.env[key]) issues.push(`${key} is missing`);
if(!process.env.APP_URL?.startsWith("https://")) issues.push("APP_URL must be the production HTTPS origin");
if(!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) issues.push("Stripe is not using a live secret key");
if(process.env.STORAGE_DRIVER==="local") issues.push("Production uploads require persistent private S3 storage");
for(const key of ["COMMISSION_BPS","RENTER_FEE_BPS"]) if(!/^\d+$/.test(process.env[key]||"") || Number(process.env[key])>10000) issues.push(`${key} must explicitly define a valid agreed fee`);
async function main(){
  try {
    await db.$queryRaw`SELECT 1`;
    if(!await db.user.count({where:{role:"ADMIN",active:true}})) issues.push("No active administrator exists");
  } catch {issues.push("Database is unreachable or migrations have not been applied");}
  if(issues.length){console.error("Launch checks failed:\n"+issues.map(x=>`- ${x}`).join("\n"));process.exitCode=1;}
  else console.log("Configuration checks passed. Complete the live provider, moderation, refunds, privacy and end-to-end launch checklist before inviting customers.");
}
main().finally(()=>db.$disconnect());
