import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";

// Use the caller's transaction so notifications never outlive a rolled-back action.
export async function notifyBooking(tx: Prisma.TransactionClient, bookingId: string, actorId: string, title: string, body: string) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { renterId: true, listing: { select: { ownerId: true } } } });
  const recipients = [...new Set([booking.renterId, booking.listing.ownerId])].filter((id) => id !== actorId);
  if (!recipients.length) return;
  await tx.notification.createMany({ data: recipients.map((userId) => ({ userId, bookingId, title: title.slice(0, 160), body: body.slice(0, 3000) })) });
}

export async function getNotifications(userId: string) {
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({ where: { userId }, select: { id: true, title: true, body: true, bookingId: true, readAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications, unreadCount };
}

export async function markNotificationsRead(userId: string, input: unknown) {
  const { id } = z.object({ id: z.string().min(1).max(100).optional() }).strict().parse(input);
  if (id && !await db.notification.findFirst({ where: { id, userId }, select: { id: true } })) {
    throw new HttpError(404, "Notification not found.");
  }
  await db.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  return getNotifications(userId);
}
