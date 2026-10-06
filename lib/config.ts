export function appUrl() {
  const value = process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!value) throw new Error("APP_URL must be configured.");
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}
export const currency = (process.env.CURRENCY || "gbp").toLowerCase();
export const commissionBps = Number(process.env.COMMISSION_BPS || 1800);
export const renterFeeBps = Number(process.env.RENTER_FEE_BPS || 800);
export const paymentsReady = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
export const mailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
