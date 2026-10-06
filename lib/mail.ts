import { HttpError } from "./http";
import { mailReady } from "./config";
export async function sendMail(to: string, subject: string, text: string) {
  if (!mailReady()) throw new HttpError(503,"Email delivery is not available yet. Please try again later.");
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new HttpError(503,"We could not send the email. Please try again shortly.");
}
