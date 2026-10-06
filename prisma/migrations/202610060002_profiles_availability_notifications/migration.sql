-- Additive migration: existing accounts and rental records are preserved.
ALTER TABLE "Booking" ADD COLUMN "stripeCheckoutParams" JSONB;
ALTER TABLE "Claim" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DAMAGE';
ALTER TABLE "User" ADD COLUMN "bio" TEXT NOT NULL DEFAULT '',
                   ADD COLUMN "location" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ListingBlock" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  CONSTRAINT "ListingBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingBlock_date_order" CHECK ("startDate" <= "endDate")
);
CREATE INDEX "ListingBlock_listingId_startDate_endDate_idx" ON "ListingBlock"("listingId", "startDate", "endDate");
ALTER TABLE "ListingBlock" ADD CONSTRAINT "ListingBlock_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "bookingId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
