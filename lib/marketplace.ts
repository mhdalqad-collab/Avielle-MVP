import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { commissionBps, renterFeeBps, currency } from "./config";
import { HttpError } from "./http";
import { notifyBooking } from "./notifications";
import { bookingSchema, dateSchema, listingSchema, quote, terminalStatuses, today, unpaidStatuses } from "./domain";

export type Tx = Prisma.TransactionClient;
export const ownerSelect = { id: true, name: true } satisfies Prisma.UserSelect;
export const listingSelect = {
  id: true, ownerId: true, title: true, description: true, brand: true, category: true, size: true,
  measurements: true, condition: true, location: true, dailyRate: true, cleaningFee: true, deposit: true,
  images: true, availableFrom: true, availableTo: true, status: true, createdAt: true, updatedAt: true,
  owner: { select: ownerSelect },
} satisfies Prisma.ListingSelect;
export const selfSelect = { id: true, name: true, email: true, role: true, active: true, emailVerifiedAt: true, payoutsEnabled: true, createdAt: true } satisfies Prisma.UserSelect;
export const bookingSelect = {
  id: true, listingId: true, renterId: true, startDate: true, endDate: true, days: true, rental: true,
  cleaningFee: true, serviceFee: true, deposit: true, total: true, ownerEarnings: true, currency: true,
  status: true, expiresAt: true, paymentStatus: true, refundedAmount: true, payoutStatus: true,
  createdAt: true, updatedAt: true, listing: { select: listingSelect }, renter: { select: ownerSelect },
  claim: true,
} satisfies Prisma.BookingSelect;
export const bookingDetailSelect = {
  ...bookingSelect, messages: { orderBy: { createdAt: "desc" as const }, take: 200 },
  evidence: { orderBy: { createdAt: "asc" as const } }, reviews: true,
  events: { orderBy: { createdAt: "desc" as const }, take: 100 },
} satisfies Prisma.BookingSelect;
export function activeReservationWhere(now = new Date()): Prisma.BookingWhereInput {
  return { status: { notIn: terminalStatuses }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }, { paymentStatus: { not: "UNPAID" } }] };
}
export async function transaction<T>(fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
}
export async function lockListing(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${id} FOR UPDATE`;
}
export async function lockBooking(tx: Tx, id: string) {
  const reference = await tx.booking.findUnique({ where: { id }, select: { listingId: true } });
  if (!reference) throw new HttpError(404, "Rental not found.");
  await lockListing(tx, reference.listingId);
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id }, include: { listing: { include: { owner: true } }, renter: true, claim: true, evidence: true } });
  return booking;
}
export async function expireReservations(tx: Tx, listingId: string) {
  const expired = await tx.booking.findMany({ where: { listingId, status: { in: unpaidStatuses }, paymentStatus: "UNPAID", expiresAt: { lte: new Date() } }, select: { id: true } });
  for (const booking of expired) {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "EXPIRED" } });
    await event(tx, booking.id, "system", "EXPIRED", "The unpaid rental request passed its response or payment deadline.");
  }
}
async function expireParticipantReservations(user: User) {
  const rows = await db.booking.findMany({ where: { status: { in: unpaidStatuses }, paymentStatus: "UNPAID", expiresAt: { lte: new Date() }, ...(user.role === "ADMIN" ? {} : { OR: [{ renterId: user.id }, { listing: { ownerId: user.id } }] }) }, select: { listingId: true }, take: 100 });
  for (const id of [...new Set(rows.map(row => row.listingId))].sort()) await transaction(async tx => { await lockListing(tx, id); await expireReservations(tx, id); });
}
export async function event(tx: Tx, bookingId: string, actorId: string, type: string, detail = "") {
  const result = await tx.bookingEvent.create({ data: { bookingId, actorId, type, detail } });
  await notifyBooking(tx, bookingId, actorId, type.toLowerCase().replaceAll("_", " "), detail || "Your rental has an update.");
  return result;
}
export function participant(booking: { renterId: string; listing: { ownerId: string } }, user: User) {
  if (user.role !== "ADMIN" && booking.renterId !== user.id && booking.listing.ownerId !== user.id) throw new HttpError(404, "Rental not found.");
}
async function ownedPhotos(tx: Tx, photos: string[], ownerId: string, purpose: string, bookingId?: string) {
  const ids = [...new Set(photos.map((url) => url.split("/").pop()!))];
  const count = await tx.upload.count({ where: { id: { in: ids }, ownerId, purpose, ...(bookingId ? { bookingId } : {}) } });
  if (count !== ids.length) throw new HttpError(400, "Use photos uploaded by your account for this listing or rental.");
}
export async function getListings(params: URLSearchParams) {
  const filter = z.object({ q: z.string().max(120).optional(), category: z.string().max(80).optional(), size: z.string().max(80).optional(), location: z.string().max(120).optional(), dateFrom: dateSchema.optional(), dateTo: dateSchema.optional() }).parse(Object.fromEntries(params));
  if (!!filter.dateFrom !== !!filter.dateTo) throw new HttpError(400, "Choose both rental dates.");
  if (filter.dateFrom && filter.dateTo) quote(100, 0, 0, filter.dateFrom, filter.dateTo, 0, 0);
  return db.listing.findMany({
    where: { status: "ACTIVE", owner: { active: true },
      ...(filter.q ? { OR: ["title", "brand", "description"].map((field) => ({ [field]: { contains: filter.q, mode: "insensitive" } })) } : {}),
      ...(filter.category ? { category: { equals: filter.category, mode: "insensitive" } } : {}),
      ...(filter.size ? { size: { equals: filter.size, mode: "insensitive" } } : {}),
      ...(filter.location ? { location: { contains: filter.location, mode: "insensitive" } } : {}),
      ...(filter.dateFrom && filter.dateTo ? { availableFrom: { lte: filter.dateFrom }, availableTo: { gte: filter.dateTo }, blocks: { none: { startDate: { lte: filter.dateTo }, endDate: { gte: filter.dateFrom } } }, bookings: { none: { ...activeReservationWhere(), startDate: { lte: filter.dateTo }, endDate: { gte: filter.dateFrom } } } } : {}),
    }, select: listingSelect, orderBy: { createdAt: "desc" }, take: 60,
  });
}
export async function getListing(id: string, user: User | null) {
  const listing = await db.listing.findUnique({ where: { id }, select: { ...listingSelect, moderationNote: true, owner: { select: { ...ownerSelect, active: true } } } });
  if (!listing || ((listing.status !== "ACTIVE" || !listing.owner.active) && user?.id !== listing.ownerId && user?.role !== "ADMIN")) throw new HttpError(404, "Piece not found.");
  const [reservedDates, rentals, blocks] = await Promise.all([
    db.booking.findMany({ where: { listingId: id, ...activeReservationWhere() }, select: { startDate: true, endDate: true } }),
    db.booking.findMany({ where: { listingId: id, status: "COMPLETED" }, select: { renterId: true, renter: { select: ownerSelect }, reviews: true }, take: 40, orderBy: { createdAt: "desc" } }),
    db.listingBlock.findMany({ where: { listingId: id }, select: { startDate: true, endDate: true } }),
  ]);
  const blockedDates = [...reservedDates, ...blocks];
  return { listing: { ...listing, moderationNote: user?.id === listing.ownerId || user?.role === "ADMIN" ? listing.moderationNote : undefined, owner: { id: listing.owner.id, name: listing.owner.name }, reviews: rentals.flatMap((rental) => rental.reviews.filter((review) => review.authorId === rental.renterId).map((review) => ({ id: review.id, rating: review.rating, comment: review.comment, createdAt: review.createdAt, author: rental.renter }))) }, blockedDates };
}
export async function createListing(user: User, input: unknown) {
  const data = listingSchema.parse(input);
  if (data.availableTo < today()) throw new HttpError(400, "Availability must include a future date.");
  return transaction(async (tx) => { await ownedPhotos(tx, data.images, user.id, "LISTING"); return tx.listing.create({ data: { ...data, ownerId: user.id }, select: listingSelect }); });
}
export async function updateListing(id: string, user: User, input: unknown) {
  const data = z.object({ action: z.enum(["pause", "resubmit", "approve", "reject", "update"]), moderationNote: z.string().trim().max(1000).optional() }).passthrough().parse(input);
  return transaction(async (tx) => {
    await lockListing(tx, id);
    const listing = await tx.listing.findUnique({ where: { id }, include: { owner: { select: { active: true } } } });
    if (!listing || (listing.ownerId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "Piece not found.");
    if (listing.status === "DELETED") throw new HttpError(409, "Deleted pieces cannot be republished. Create a new listing if needed.");
    if (["approve", "reject"].includes(data.action) && user.role !== "ADMIN") throw new HttpError(403, "Marketplace review is required.");
    if (data.action === "approve" && !listing.owner.active) throw new HttpError(409, "The lender account is suspended.");
    if (data.action === "update") {
      const { action: _action, moderationNote: _note, ...fields } = data;
      const edited = listingSchema.parse(fields);
      if (edited.availableTo < today()) throw new HttpError(400, "Availability must include a future date.");
      await ownedPhotos(tx, edited.images, listing.ownerId, "LISTING");
      if (await tx.booking.count({ where: { listingId: id, ...activeReservationWhere() } })) throw new HttpError(409, "Finish or cancel open rental requests before editing the piece.");
      return tx.listing.update({ where: { id }, data: { ...edited, status: "PENDING", moderationNote: "" }, select: listingSelect });
    }
    const status = { pause: "PAUSED", resubmit: "PENDING", approve: "ACTIVE", reject: "REJECTED" }[data.action];
    return tx.listing.update({ where: { id }, data: { status, moderationNote: user.role === "ADMIN" ? data.moderationNote ?? "" : "" }, select: listingSelect });
  });
}
export async function dashboard(user: User) {
  await expireParticipantReservations(user);
  const [listings, bookings] = await Promise.all([
    db.listing.findMany({ where: { ownerId: user.id, status: { not: "DELETED" } }, select: { ...listingSelect, moderationNote: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.booking.findMany({ where: { OR: [{ renterId: user.id }, { listing: { ownerId: user.id } }] }, select: bookingSelect, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const self = { id: user.id, name: user.name, email: user.email, role: user.role, emailVerifiedAt: user.emailVerifiedAt, payoutsEnabled: user.payoutsEnabled };
  if (user.role !== "ADMIN") return { listings, bookings, user: self };
  const [allListings, allBookings, users] = await Promise.all([
    db.listing.findMany({ where: { status: { not: "DELETED" } }, select: { ...listingSelect, moderationNote: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.booking.findMany({ select: bookingSelect, orderBy: { createdAt: "desc" }, take: 100 }),
    db.user.findMany({ select: selfSelect, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return { listings, bookings, user: self, admin: { listings: allListings, bookings: allBookings, users } };
}
export async function requestBooking(user: User, input: unknown) {
  const data = bookingSchema.parse(input);
  return transaction(async (tx) => {
    await lockListing(tx, data.listingId);
    await expireReservations(tx, data.listingId);
    const listing = await tx.listing.findUnique({ where: { id: data.listingId }, include: { owner: { select: { active: true } } } });
    if (!listing || listing.status !== "ACTIVE" || !listing.owner.active) throw new HttpError(409, "This piece is not available for requests.");
    if (listing.ownerId === user.id) throw new HttpError(400, "You cannot rent your own piece.");
    if (data.startDate < today() || data.startDate < listing.availableFrom || data.endDate > listing.availableTo) throw new HttpError(400, "Choose future dates within the piece's availability.");
    const totals = quote(listing.dailyRate, listing.cleaningFee, listing.deposit, data.startDate, data.endDate, commissionBps, renterFeeBps);
    if (await tx.listingBlock.count({ where: { listingId: listing.id, startDate: { lte: data.endDate }, endDate: { gte: data.startDate } } })) throw new HttpError(409, "The lender has marked these dates unavailable.");
    if (await tx.booking.findFirst({ where: { listingId: listing.id, ...activeReservationWhere(), startDate: { lte: data.endDate }, endDate: { gte: data.startDate } }, select: { id: true } })) throw new HttpError(409, "These dates have just been reserved. Please choose different dates.");
    const booking = await tx.booking.create({ data: { ...data, ...totals, renterId: user.id, currency, expiresAt: new Date(Date.now() + 48 * 3600_000) }, select: bookingSelect });
    await event(tx, booking.id, user.id, "REQUESTED", "Rental requested; lender approval required within 48 hours.");
    return booking;
  });
}
export async function getBooking(id: string, user: User) {
  let booking = await db.booking.findUnique({ where: { id }, select: bookingDetailSelect });
  if (!booking) throw new HttpError(404, "Rental not found.");
  participant(booking, user);
  if (unpaidStatuses.includes(booking.status) && booking.paymentStatus === "UNPAID" && booking.expiresAt && booking.expiresAt <= new Date()) {
    const listingId = booking.listingId;
    await transaction(async tx => { await lockListing(tx, listingId); await expireReservations(tx, listingId); });
    booking = await db.booking.findUniqueOrThrow({ where: { id }, select: bookingDetailSelect });
  }
  return { ...booking, messages: booking.messages.reverse() };
}
export async function bookingAction(id: string, user: User, input: unknown): Promise<{ paymentWork?: "cancel" | "settle" }> {
  const action = z.object({ action: z.enum(["approve", "decline", "cancel", "handover", "return", "complete", "message", "evidence", "claim", "resolve", "review"]) }).passthrough().parse(input);
  return transaction(async (tx) => {
    let booking = await lockBooking(tx, id);
    participant(booking, user);
    if (unpaidStatuses.includes(booking.status) && booking.paymentStatus === "UNPAID" && booking.expiresAt && booking.expiresAt <= new Date()) {
      await tx.booking.update({ where: { id }, data: { status: "EXPIRED" } });
      booking = { ...booking, status: "EXPIRED" };
    }
    const owner = booking.listing.ownerId === user.id, renter = booking.renterId === user.id, admin = user.role === "ADMIN";
    const requireRole = (allowed: boolean) => { if (!allowed) throw new HttpError(403, "Only the appropriate rental participant can perform this action."); };
    const requireState = (...statuses: string[]) => { if (!statuses.includes(booking.status)) throw new HttpError(409, "This action is unavailable at the rental's current stage."); };
    const move = async (status: string, detail = "") => { await tx.booking.update({ where: { id }, data: { status } }); await event(tx, id, user.id, status, detail); };
    const hasEvidence = (authorId: string, phase: string) => booking.evidence.some((evidence) => evidence.authorId === authorId && evidence.phase === phase && evidence.photos.length > 0);
    switch (action.action) {
      case "message": {
        const { text } = z.object({ text: z.string().trim().min(1).max(3000) }).parse(action);
        await tx.message.create({ data: { bookingId: id, senderId: user.id, text } });
        await notifyBooking(tx, id, user.id, "New message", "You have a new message in your rental conversation."); return {};
      }
      case "evidence": {
        requireRole(owner || renter);
        const data = z.object({ phase: z.enum(["BEFORE", "AFTER"]), photos: z.array(z.string().regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/)).min(1).max(6), notes: z.string().trim().min(3).max(3000) }).parse(action);
        if (data.phase === "BEFORE") { requireState("CONFIRMED", "IN_USE"); if (owner && booking.status !== "CONFIRMED") throw new HttpError(409, "Handover evidence is sealed once the rental starts."); }
        else requireState("IN_USE", "RETURNED");
        if (booking.claim?.status === "OPEN") throw new HttpError(409, "Evidence is sealed while a claim is reviewed.");
        await ownedPhotos(tx, data.photos, user.id, "EVIDENCE", id);
        const existing = await tx.evidence.findUnique({ where: { bookingId_authorId_phase: { bookingId: id, authorId: user.id, phase: data.phase } } });
        if (existing) throw new HttpError(409, "This condition report is already saved and cannot be overwritten. Add corrections in the rental conversation.");
        await tx.evidence.create({ data: { ...data, bookingId: id, authorId: user.id } });
        await event(tx, id, user.id, "EVIDENCE_ADDED", `${data.phase} condition report saved.`); return {};
      }
      case "approve":
        requireRole(owner); requireState("REQUESTED");
        if (booking.listing.status !== "ACTIVE" || !booking.listing.owner.active || !booking.renter.active) throw new HttpError(409, "This rental is no longer eligible for approval.");
        await tx.booking.update({ where: { id }, data: { status: "APPROVED", expiresAt: new Date(Date.now() + 24 * 3600_000) } });
        await event(tx, id, user.id, "APPROVED", "Please pay within 24 hours to confirm the rental."); return {};
      case "decline": requireRole(owner); requireState("REQUESTED"); await move("DECLINED"); return {};
      case "cancel":
        requireRole(owner || renter || admin); requireState("REQUESTED", "APPROVED", "CHECKOUT_PENDING", "CONFIRMED", "CANCELLING", "EXPIRED");
        if (booking.paymentStatus === "DISPUTED") throw new HttpError(409, "Operations must resolve the payment dispute before cancellation.");
        await move("CANCELLING", "Cancellation requested; any charge will be refunded before cancellation completes.");
        return { paymentWork: "cancel" };
      case "handover":
        requireRole(owner); requireState("CONFIRMED");
        if (booking.paymentStatus !== "PAID" || booking.startDate > today() || booking.endDate < today()) throw new HttpError(409, "Handover requires a confirmed payment and current rental dates.");
        if (!hasEvidence(user.id, "BEFORE")) throw new HttpError(400, "Save the lender's before-handover condition report first.");
        await move("IN_USE", "Lender confirmed handover."); return {};
      case "return":
        requireRole(renter); requireState("IN_USE");
        if (!hasEvidence(user.id, "AFTER")) throw new HttpError(400, "Save your after-rental condition report first.");
        await move("RETURNED", "Renter marked the piece returned; lender inspection is required."); return {};
      case "complete":
        requireRole(owner || admin); requireState("RETURNED", "LOSS_RESOLVED", "SETTLING", "SETTLEMENT_FAILED");
        const resolvedLoss = booking.claim?.kind === "NOT_RETURNED" && booking.claim.status === "RESOLVED";
        if (!resolvedLoss && !hasEvidence(booking.listing.ownerId, "AFTER")) throw new HttpError(400, "The lender must save an after-return inspection first.");
        if (booking.claim?.status === "OPEN") throw new HttpError(409, "Resolve the open claim before settlement.");
        const retrying = ["SETTLING", "SETTLEMENT_FAILED"].includes(booking.status);
        if (!["PAID", "PARTIALLY_REFUNDED", ...(retrying ? ["REFUND_PENDING"] : [])].includes(booking.paymentStatus)) throw new HttpError(409, "Payment reconciliation is required before settlement.");
        await move("SETTLING", "Return accepted; deposit refund and lender transfer requested."); return { paymentWork: "settle" };
      case "claim": {
        requireRole(owner); requireState("RETURNED", "IN_USE");
        const kind = z.enum(["DAMAGE", "NOT_RETURNED"]).default("DAMAGE").parse(action.kind);
        if (kind === "DAMAGE" && booking.status !== "RETURNED") throw new HttpError(409, "Damage claims require a returned piece and inspection.");
        if (kind === "NOT_RETURNED" && (booking.status !== "IN_USE" || booking.endDate >= today())) throw new HttpError(409, "A missing-return claim is available only after the rental end date has passed.");
        if (!hasEvidence(user.id, "BEFORE") || (kind === "DAMAGE" && !hasEvidence(user.id, "AFTER"))) throw new HttpError(400, "Save the required condition evidence before opening a claim.");
        if (booking.claim) throw new HttpError(409, "This rental already has a claim.");
        const data = z.object({ description: z.string().trim().min(20).max(5000), requestedAmount: z.number().int().min(0).max(booking.deposit) }).parse(action);
        await tx.claim.create({ data: { ...data, kind, bookingId: id, openedBy: user.id } }); await move("CLAIM_OPEN", "Settlement is paused while operations reviews the claim."); return {};
      }
      case "resolve": {
        requireRole(admin); requireState("CLAIM_OPEN");
        if (!booking.claim || booking.claim.status !== "OPEN") throw new HttpError(409, "There is no open claim.");
        const data = z.object({ resolution: z.string().trim().min(20).max(5000), awardedAmount: z.number().int().min(0).max(Math.min(booking.deposit, booking.claim.requestedAmount)) }).parse(action);
        await tx.claim.update({ where: { bookingId: id }, data: { ...data, status: "RESOLVED" } });
        if (booking.claim.kind === "NOT_RETURNED") {
          await tx.listing.update({ where: { id: booking.listingId }, data: { status: "PAUSED", moderationNote: "Publication paused after a resolved missing-return claim. Contact operations before relisting." } });
          await move("LOSS_RESOLVED", data.resolution);
        } else await move("RETURNED", data.resolution);
        return {};
      }
      case "review": {
        requireRole(owner || renter); requireState("COMPLETED");
        const data = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(3).max(2000) }).parse(action);
        if (await tx.review.findUnique({ where: { bookingId_authorId: { bookingId: id, authorId: user.id } } })) throw new HttpError(409, "You have already reviewed this rental.");
        await tx.review.create({ data: { ...data, bookingId: id, authorId: user.id } }); return {};
      }
    }
  });
}
