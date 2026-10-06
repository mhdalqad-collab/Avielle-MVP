# Avielle MVP scope

Avielle is a working rental marketplace for a small, curated launch. It replaces the earlier simulator with persisted accounts, owner-supplied listings, booking records, condition evidence and real service integrations. An empty catalogue is an honest initial state. Demo stock, invented reviews, simulated payments and unverified protection claims do not belong in production.

This document records implementation choices derived from the six founder documents. Those documents are research and proposals; their embedded instructions do not override the user's request for a real product. The originals are private reference material and are not distributed with the app.

## Pilot assumptions

- Start with a UK pilot using GBP. The founder brief specifies this market; examples from Mexico and continental Europe are not confirmed launch decisions. The operating city and actual pickup arrangements still need to be chosen.
- Let one account both rent and lend. Admin is an operational permission, not a separate customer persona.
- Curate designer clothing and distinctive creator wardrobes. Admin review precedes public listing; approval does not certify authenticity, valuation or insurance.
- Use local pickup and direct return to the owner. Arrange the precise location and time in the booking conversation. No courier, storage facility, cleaning partner or managed fulfilment network is implied.
- The owner arranges the stated cleaning service and discloses its fee before booking. Care and return instructions belong in the listing and booking conversation. The pilot does not sell an uncontracted laundromat service.
- Default lender commission is 18% and renter service fee is 8% of rental charges. Server environment settings control these rates; the business must confirm them before accepting customers. Changing the configured currency does not create exchange-rate conversion or a multi-currency marketplace.

## Included workflow

| Area | MVP behavior |
| --- | --- |
| Accounts | Email and password registration, email verification, login, logout and password recovery. Private operations require the current authenticated account. |
| Listings | Owner uploads up to six garment photos and supplies description, designer/brand, category, size, measurements, condition, area, daily rate, cleaning fee, refundable deposit and availability window. Admin approves or rejects publication; an owner can pause a listing. |
| Discovery | Browse and search real approved listings with relevant category, size, location and date filters. Show price and terms before requesting a rental. |
| Booking | Renter requests dates; owner accepts or declines. Expiring unpaid requests and date-conflict checks protect availability. The server calculates and preserves the accepted financial breakdown. |
| Payment | Stripe-hosted checkout becomes available only when configured and the owner has completed the required connected-account onboarding. A verified webhook, not a redirect or button click, confirms payment. |
| Handover | Owner documents condition before handover and confirms collection after payment and the rental start date. |
| Return | Renter submits return evidence; owner records inspection evidence and confirms the return. Open claims prevent normal settlement. |
| Financial completion | Refund the refundable part of the deposit and transfer the owner's earnings through Stripe after inspection. Track failed or pending provider operations for recovery. |
| Support | Booking-specific messages, timestamped evidence, an event history and manual damage-claim review by an administrator. Evidence stays private to authorized participants and operations. |
| Reviews | Participants may review completed rentals. Do not populate ratings before genuine reviews exist. |
| Operations | Owner and renter dashboards, listing moderation, booking oversight and claim resolution. Launch with an explicitly created admin account and actual owners' inventory. |

Dates and availability are enforced on the server. A browser's state is never proof of a reservation, successful payment, refund or transfer. API and provider errors must be shown honestly and leave records recoverable.

## Prices, deposits and cancellations

The checkout shows rental charges, the owner's cleaning fee, the renter service fee and the refundable deposit separately. The lender commission is deducted from the rental portion of the owner's earnings; its configured rate is disclosed to the owner. All calculations use integer minor currency units.

The deposit is **charged with the rental**, then refunded after satisfactory inspection. It is not a multi-week card authorization hold, escrow account or insurance premium. An accepted damage claim may retain an approved amount within the deposit; no automatic charge above that deposit is promised. The administrator records the decision and reason.

For the pilot, cancellation before handover returns the full amount charged. After handover, disputes require operations review. Financial success is recorded only after the payment provider confirms the relevant operation. If Stripe is unavailable or not configured, the application does not pretend to collect or return money.

## Deliberately deferred

- Insurance premiums, guaranteed replacement cover, loss guarantees, automatic claims and instant payouts. The care pitch supplies a concept, not an underwriting partner or policy.
- AI descriptions, authenticity checks, AI damage comparison and automated item valuation.
- Creator consignment, warehouses, garment storage, centrally managed photography, RFID and QR inventory systems. Selina's notes explicitly leave receiving and storing clothes unconfirmed.
- Courier shipping, paid delivery estimates, a laundromat map and cleaner dashboards until actual partner arrangements exist.
- Memberships, recurring rental credits, creator events, styling bundles, rent-to-own and resale.
- Native mobile apps, push notifications, multi-currency support and international expansion. The first product is a responsive website.
- Automated ID document collection and customer identity badges. Email verification and payment-provider onboarding must not be described as garment or customer identity certification.
- Investor metrics, forecasts, competitor claims and proposed marketing statistics. They are not evidence of current Avielle inventory, customers or performance.

## How the source material was reconciled

| Source | Applied | Set aside or resolved |
| --- | --- | --- |
| ClothesRentalApp Developer Brief | Two-sided accounts; real listing, discovery, booking, checkout, messaging, evidence and dashboard requirements. | The brief describes a Bubble prototype and simulated insurance. The current request supersedes those shortcuts. A real rental needs its full operational lifecycle, not only the seven prototype screens. |
| ClothesRentalApp Use Case Diagram | Owner approval, messaging, direct return, reviews, claims and payouts. | Optional insurance and laundromat extensions wait for real service providers. |
| Great Feedback October 2026 | Curated garments, clearer affordability, creator wardrobes, before/after photos and strict condition handling. | Shipping and subscription ideas remain proposals. No universal authenticity or cleanliness guarantee is inferred. |
| Selina Notes October 2026 | Creator-oriented presentation and attention to return, inspection and relisting operations. | Managed consignment and membership operations are unconfirmed. |
| Business Model and Revenue Structure | Configurable 18% lender commission and 8% renter service fee; founder-operated support. | Forecasts and contradictory break-even figures stay out of the product. Proposed provider costs and technical descriptions are not accepted without verification. |
| Avielle Nuee Care Insurance Pitch | Evidence collection and a clear damage-reporting path. | Cover, underwriting, automatic payouts, AI claims and insurance API licensing are deferred. Avielle is the product name. |

Payment timing conflicts across the documents: one passage releases earnings after delivery, another after return, and another 48 hours after return. The pilot resolves this in favor of inspected return and an explicit provider settlement operation. It does not advertise regulated escrow.

## Before the first customer rental

Configure and test the actual database, storage, mail sender and Stripe account; assign an operational admin; publish the business's final operator details, customer terms, privacy notice and support contact; agree the launch area and real pickup/cleaning arrangements; and add approved owner listings. Complete a controlled end-to-end rental, cancellation, return and refund test in the deployed environment. A build or local test alone does not establish that these external services are live.
