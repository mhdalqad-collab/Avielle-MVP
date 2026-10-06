import { stripeClient, handleStripeEvent, verifyStripeEvent } from "@/lib/payments";
import { HttpError, readBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Payment webhooks are not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });
  let body: string;
  try { body = (await readBody(request, 1_000_000)).toString("utf8"); }
  catch (error) { return Response.json({ error: "Payload too large or unreadable." }, { status: error instanceof HttpError ? error.status : 400 }); }
  let event;
  try { event = verifyStripeEvent(body, signature, stripeClient(), process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_SECRET_KEY); }
  catch (error) { return Response.json({ error: error instanceof HttpError ? error.message : "Invalid webhook signature." }, { status: error instanceof HttpError ? error.status : 400 }); }
  try { await handleStripeEvent(event); return Response.json({ received: true }); }
  catch (error) { console.error("Stripe event processing failed", event.id, error instanceof Error ? error.name : "unknown"); return Response.json({ error: "Payment event could not be processed. Retry required." }, { status: 500 }); }
}
