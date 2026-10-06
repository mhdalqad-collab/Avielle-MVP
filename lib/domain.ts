import { z } from "zod";

export const DAY = 86_400_000;
export const terminalStatuses = ["CANCELLED", "DECLINED", "EXPIRED", "COMPLETED"];
export const unpaidStatuses = ["REQUESTED", "APPROVED", "CHECKOUT_PENDING"];
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates.").refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");
export function today() { return new Date().toISOString().slice(0, 10); }
export function rentalDays(start: string, end: string) {
  dateSchema.parse(start); dateSchema.parse(end);
  const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
  if (days < 1 || days > 60) throw new Error("Rentals must be between 1 and 60 calendar days.");
  return days;
}
export function quote(dailyRate: number, cleaningFee: number, deposit: number, start: string, end: string, commissionBps: number, renterFeeBps: number) {
  for (const value of [dailyRate, cleaningFee, deposit, commissionBps, renterFeeBps]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid pricing configuration.");
  }
  if (commissionBps > 10000 || renterFeeBps > 10000) throw new Error("Invalid fee configuration.");
  const days = rentalDays(start, end), rental = dailyRate * days;
  const serviceFee = Math.round(rental * renterFeeBps / 10000);
  const ownerEarnings = rental - Math.round(rental * commissionBps / 10000) + cleaningFee;
  const total = rental + cleaningFee + serviceFee + deposit;
  if (!Number.isSafeInteger(total) || total < 50 || total >= 100_000_000) throw new Error("The rental total is outside the supported payment range.");
  return { days, rental, cleaningFee, serviceFee, deposit, ownerEarnings, total };
}
export const listingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(5000),
  brand: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80),
  size: z.string().trim().min(1).max(80),
  measurements: z.string().trim().max(1000).default(""),
  condition: z.string().trim().min(1).max(200),
  location: z.string().trim().min(2).max(120),
  dailyRate: z.number().int().min(50).max(1_000_000),
  cleaningFee: z.number().int().min(0).max(1_000_000).default(0),
  deposit: z.number().int().min(0).max(5_000_000).default(0),
  images: z.array(z.string().regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/)).min(1).max(6),
  availableFrom: dateSchema,
  availableTo: dateSchema,
}).strict().refine((value) => value.availableFrom <= value.availableTo, { message: "Availability end must follow its start.", path: ["availableTo"] });
export const bookingSchema = z.object({ listingId: z.string().min(1).max(100), startDate: dateSchema, endDate: dateSchema }).strict();
export function settlementAmounts(booking: { deposit: number; ownerEarnings: number }, award: number) {
  if (!Number.isSafeInteger(award) || award < 0 || award > booking.deposit) throw new Error("The award must be within the charged deposit.");
  return { refund: booking.deposit - award, transfer: booking.ownerEarnings + award };
}
