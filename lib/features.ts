import { type Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { dateSchema, today } from "./domain";
import { HttpError } from "./http";
import { activeReservationWhere, expireReservations, listingSelect, lockListing, transaction } from "./marketplace";

const profileSelect = {
  id: true, name: true, email: true, role: true, bio: true, location: true,
  emailVerifiedAt: true, payoutsEnabled: true, createdAt: true,
} satisfies Prisma.UserSelect;
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(1000),
  location: z.string().trim().max(120),
}).strict();

export async function getProfile(user: User) {
  return db.user.findUniqueOrThrow({ where: { id: user.id }, select: profileSelect });
}
export async function updateProfile(user: User, input: unknown) {
  return db.user.update({ where: { id: user.id }, data: profileSchema.parse(input), select: profileSelect });
}
export async function getMemberProfile(id: string) {
  const profile = await db.user.findFirst({
    where: { id, active: true },
    select: { id: true, name: true, bio: true, location: true, createdAt: true,
      listings: { where: { status: "ACTIVE" }, select: listingSelect, orderBy: { createdAt: "desc" }, take: 60 },
    },
  });
  if (!profile) throw new HttpError(404, "Member not found.");
  const rentals = await db.booking.findMany({
    where: { status: "COMPLETED", OR: [{ renterId: id }, { listing: { ownerId: id } }] },
    select: { renter: { select: { id: true, name: true } }, listing: { select: { owner: { select: { id: true, name: true } } } }, reviews: true },
    orderBy: { updatedAt: "desc" }, take: 100,
  });
  const reviews = rentals.flatMap((rental) => rental.reviews
    .filter((review) => review.authorId !== id && [rental.renter.id, rental.listing.owner.id].includes(review.authorId))
    .map((review) => ({ id: review.id, rating: review.rating, comment: review.comment, createdAt: review.createdAt,
      author: review.authorId === rental.renter.id ? rental.renter : rental.listing.owner })));
  return { ...profile, reviews };
}

export async function deleteListing(id: string, user: User) {
  return transaction(async (tx) => {
    await lockListing(tx, id);
    const listing = await tx.listing.findUnique({ where: { id } });
    if (!listing || (listing.ownerId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "Piece not found.");
    await expireReservations(tx, id);
    if (await tx.booking.count({ where: { listingId: id, ...activeReservationWhere() } })) {
      throw new HttpError(409, "Finish or cancel open rentals before deleting this piece.");
    }
    // Keep the row and its images for historical bookings, evidence and financial records.
    return tx.listing.update({ where: { id }, data: { status: "DELETED" }, select: listingSelect });
  });
}

export async function getAvailability(id: string, user: User | null) {
  const listing = await db.listing.findUnique({ where: { id }, select: { ownerId: true, status: true, owner: { select: { active: true } } } });
  if (!listing || ((listing.status !== "ACTIVE" || !listing.owner.active) && listing.ownerId !== user?.id && user?.role !== "ADMIN")) {
    throw new HttpError(404, "Piece not found.");
  }
  const [blocks, reservations] = await Promise.all([
    db.listingBlock.findMany({ where: { listingId: id }, orderBy: { startDate: "asc" } }),
    db.booking.findMany({ where: { listingId: id, ...activeReservationWhere() }, select: { startDate: true, endDate: true } }),
  ]);
  return { blocks, blockedDates: [...blocks.map(({ startDate, endDate }) => ({ startDate, endDate })), ...reservations] };
}

const blockSchema = z.object({ startDate: dateSchema, endDate: dateSchema }).strict()
  .refine((value) => value.startDate <= value.endDate, { message: "End date must follow the start.", path: ["endDate"] });

export async function addAvailabilityBlock(id: string, user: User, input: unknown) {
  const data = blockSchema.parse(input);
  return transaction(async (tx) => {
    await lockListing(tx, id);
    const listing = await tx.listing.findUnique({ where: { id } });
    if (!listing || (listing.ownerId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "Piece not found.");
    if (listing.status === "DELETED") throw new HttpError(409, "Deleted pieces cannot be changed.");
    if (data.startDate < listing.availableFrom || data.endDate > listing.availableTo || data.endDate < today()) {
      throw new HttpError(400, "Choose dates within the piece's availability that include a future date.");
    }
    await expireReservations(tx, id);
    const overlap = { startDate: { lte: data.endDate }, endDate: { gte: data.startDate } };
    if (await tx.booking.count({ where: { listingId: id, ...activeReservationWhere(), ...overlap } })) {
      throw new HttpError(409, "These dates already have an open rental. Finish or cancel it before blocking dates.");
    }
    if (await tx.listingBlock.count({ where: { listingId: id, ...overlap } })) {
      throw new HttpError(409, "These dates overlap an existing unavailable period.");
    }
    return tx.listingBlock.create({ data: { listingId: id, ...data } });
  });
}

export async function removeAvailabilityBlock(id: string, user: User, blockId: string) {
  z.string().min(1).max(100).parse(blockId);
  return transaction(async (tx) => {
    await lockListing(tx, id);
    const listing = await tx.listing.findUnique({ where: { id } });
    if (!listing || (listing.ownerId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "Piece not found.");
    const result = await tx.listingBlock.deleteMany({ where: { id: blockId, listingId: id } });
    if (!result.count) throw new HttpError(404, "Unavailable period not found.");
  });
}
