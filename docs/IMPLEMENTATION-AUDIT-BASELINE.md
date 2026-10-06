# Baseline audit before completion work

Audited 6 October 2026 against the existing uncommitted repository. This is the baseline before further application changes, not the final completion report. Source implementation does not imply a tested working feature.

## Completed and checked

- [x] New isolated Avielle-MVP checkout targets the requested GitHub repository; original simulator is separate.
- [x] Production flows use PostgreSQL/Prisma records; no seeded fictional accounts, merchandise or booking data.
- [x] Password hashing, token entropy, origin enforcement, bounded request parsing and pricing/claim arithmetic: seven unit tests pass.
- [x] Initial PostgreSQL migration, environment template, CI definition and preliminary local/GoDaddy documentation exist.

## Partially completed

| Required feature | Baseline evidence and remaining work |
| --- | --- |
| Sign up / login / logout | UI and persistent sessions exist; no HTTP/browser verification; registration depends on configured email. |
| Email verification | Expiring hashed tokens, resend and confirmation exist; delivery and full flow untested. |
| Renter/lender profiles | One dual-role account and display name exist; editable/public profiles absent. |
| Create/edit/delete listing | Creation and backend edit/moderation exist; edit UI and deletion absent. |
| Photo uploads | Authenticated decode/re-encode/storage API exists; UI validation differs and source is accidentally Git-ignored. |
| Availability calendar | Server checks listing date window and booking overlap; no calendar or owner blackout dates. |
| Browse/search/filter | Real database search/category/size/location/date filters and UI exist; runtime untested. |
| Listing details | Real detail, pricing and date controls exist; runtime untested. |
| Rental date selection | Server calendar validation and quote exist; UI/API bounds need alignment. |
| Booking request | Persistent request and listing locks exist; full HTTP/concurrency tests not run. |
| Lender accept/decline | Backend actions exist; missing booking page prevents access. |
| Checkout/payment | Stripe Connect, hosted Checkout and signed webhook code exists; compile/recovery issues; no provider tests. |
| Persistent booking data | Schema/migration/services exist; integration suite has not run. |
| Renter/lender dashboards | Separate tabs exist; runtime untested; active count uses wrong status. |
| Active rentals | State model exists; booking page and correct active view missing. |
| Messages per booking | Participant-scoped storage exists; UI absent and messages after first 200 become invisible. |
| Before/after condition photos | Protected uploads and immutable evidence rules exist; UI absent. |
| Return confirmation | Renter return and lender inspection actions exist; UI absent. |
| Payout state | Provider IDs/state exist; pending refund recovery and dispute ordering bugs. |
| Reviews | Completed-only backend and detail display exist; submission UI absent. |

## Missing

- [ ] Booking page and complete booking controls.
- [ ] Application stylesheet.
- [ ] Editable profile and public lender/renter profile.
- [ ] Listing edit UI and safe deletion.
- [ ] Availability calendar with owner blackouts.
- [ ] Persistent basic notifications and unread/read UI.
- [ ] End-to-end HTTP/browser renter and lender journey tests.
- [ ] Provider-boundary checkout, webhook, refund and payout tests.
- [ ] Successful production build and production-install rehearsal.
- [ ] Git commit/push and final deployment report.

## Broken or unsafe until fixed

- [ ] Typecheck: missing `components/booking.tsx`; Stripe refund/transfer response type mismatches.
- [ ] Build: missing `app/globals.css` as well as the booking import.
- [ ] `.gitignore` rule `uploads/` excludes `app/api/uploads/route.ts`; scope it to the root.
- [ ] UI accepts 8 MB photos while API limits 5 MB; other name/password/measurement/moderation limits differ.
- [ ] Checkout retries reuse a fixed idempotency key with a changing expiration timestamp.
- [ ] Pending deposit-refund retries can be rejected before reaching settlement recovery.
- [ ] Refund webhooks can overwrite disputed-payment state.
- [ ] Missing/nonreturned garments have no claim-resolution path.
- [ ] Unpaid expiry is reflected inconsistently in read models.
- [ ] Tests report success while the database integration suite is skipped without TEST_DATABASE_URL.

## External deployment blockers

No configured live GoDaddy deployment/domain, production database, private persistent S3 bucket, verified Resend sender, Stripe platform/Connect credentials or signed-webhook endpoint has been demonstrated. The operator identity, support contact and final customer policies remain unconfigured. Do not substitute a mock for any missing production service. Automated provider test doubles, if used, must stay exclusively in isolated tests and be reported as such.

The final report must separately identify code verification, provider sandbox verification and live launch readiness.
