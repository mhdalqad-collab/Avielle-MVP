# Internal implementation contract

New app C:/Users/mhdal/Desktop/Avielle/mvp. Preserve ../website simulator. Next.js 15 / React 19 / Prisma 6 Postgres / TS; schema in prisma/schema.prisma is authority. All amounts integer minor units. Default GBP, lender commission 18%, renter service fee 8%, configurable. Local pickup only for first pilot; no uncontracted courier/insurance. Refundable deposit is actually charged, not represented as a long card hold. Release money only after inspected return; operations triggers real Stripe settlement. No fake inventory or accounts.

## Shared infrastructure owned by root
- lib/db.ts exports db
- lib/config.ts exports appUrl(), currency, commissionBps, renterFeeBps, paymentsReady(), mailReady()
- lib/auth.ts exports currentUser(): Promise<User|null>, requireUser(): Promise<User> (reject unauthenticated/suspended), requireVerifiedUser(): Promise<User>
- lib/http.ts exports HttpError(status,message), apiError(error): Response, assertSameOrigin(request), readJson(request): Promise<unknown>, rateLimit(key,limit,windowSeconds): Promise<void>
- lib/mail.ts exports sendMail(to,subject,text): Promise<void>
- /api/auth POST {action:register|login|logout|forgot|reset|verify|resend, name?,email?,password?,token?}; GET {user: {id,name,email,role,emailVerifiedAt,payoutsEnabled}|null}. All mutations same origin.
- /api/uploads POST multipart file,purpose=LISTING|EVIDENCE,bookingId? returns {url:'/api/media/id',id}; /api/media/[id] private evidence and owner/public-approved listing access. Listings/images and evidence/photos contain these relative URLs ONLY. Validate upload ownership in domain API before saving.
- no client actor IDs. Every API private response Cache-Control no-store.

## Domain and payment API (backend agent)
- GET /api/listings: {listings:[Listing & {owner:{id,name},reviews?:...}],currency,commissionBps,renterFeeBps,paymentsReady}; support q/category/size/location/dateFrom/dateTo filters. Public only ACTIVE and active owners; explicitly project safe fields.
- GET /api/listings/[id]: {listing: ... safe with owner, blockedDates:[{startDate,endDate}]}; published or owner/admin access. Return reviews if feasible.
- POST /api/listings: {title,description,brand,category,size,measurements,condition,location,dailyRate,cleaningFee,deposit,images,availableFrom,availableTo}; verified member, starts PENDING. PATCH /api/listings/[id] owner pause/resubmit or admin approve/reject with moderationNote; schema validate.
- GET /api/dashboard: {listings: own,bookings: participant with listing + renter:{id,name} + listing.owner:{id,name}, user:{...safe}, admin?:{listings pending/all,bookings,users safe}}. Never password/session fields, email private to self/admin.
- POST /api/bookings {listingId,startDate,endDate} -> {booking}; serializable/row lock for overlapping active reservations. REQUESTED 48h expiry, APPROVED 24h expiry; Stripe CHECKOUT_PENDING 30min. Date expiry must not release paid bookings. Real time.
- GET /api/bookings/[id] -> {booking: includes safe listing+renter+messages+evidence+claim+reviews+events}; participants/admin only.
- POST /api/bookings/[id] {action:approve|decline|cancel|handover|return|complete|message|evidence|claim|resolve|review, ...fields}; role/state checks. 'handover' owner only after paid and startDate arrived with owner's BEFORE evidence, 'return' renter with AFTER evidence; 'complete' owner after RETURNED and owner's AFTER evidence, no open claim; then real settlement. Claim freezes settlement, admin resolve requires resolution and awardedAmount<=deposit/requestedAmount. message text; evidence phase BEFORE|AFTER photos notes; review rating/comment after COMPLETED. Cancellation paid pre-handover full refund only; no simulated financial success. Real provider failures preserve recoverable state.
- POST /api/payments/checkout {bookingId} -> {url}; approved participant only, live verified owner Connect account required. Hosted Stripe checkout, separate charges/transfers, use signature-verified webhook; no charge if no keys. Authoritative confirmation by webhook only. Refund deposit + transfer owner earnings after completion through provider with idempotency. No payouts before return.
- POST /api/payments/connect -> {url}; verified user, real Stripe Express onboarding return /dashboard; GET optional status sync.
- POST /api/payments/webhook Stripe raw body signature, durable idempotent event dedup transaction. Do not trust redirect query. Prevent expired/late payments from reconfirming expired booking; reconcile or refund.

## Frontend agent
Own app pages/layout/styles and components only. React client UI acceptable with above APIs. Routes /, /explore, /items/[id], /login, /register, /forgot-password, /reset-password?token, /verify-email?token, /dashboard (tabs listing, rentals, admin), /list, /bookings/[id], /how-it-works. Use catchall route if preferred. Proper empty/unconfigured states; no inventory seed, proof stats, fake reviews/badges. Auth gating and sign out; login next path internal only. Listing photo upload max6; booking before/after evidence upload and messaging. Terms acceptance should explain fees, charged refundable deposit, local pickup and refund policy; avoid invented insurance/authenticity/escrow guarantees. Keep business rates in API not frontend fixed. Single account rents/lends. Refined Avielle forest green/cream, editorial photo /images/hero.jpg only on landing (never catalog listing). Reuse visual design of ../website for continuity. Accessible mobile layouts.

All agents coordinate interface/schema changes with root; don't overwrite others' files. Root manages dependencies/migrations/tests/build/repo/hosting docs.
