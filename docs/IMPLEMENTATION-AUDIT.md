# Avielle MVP implementation audit

Updated 7 October 2026 after application, native PostgreSQL, browser and production verification. The [original baseline](IMPLEMENTATION-AUDIT-BASELINE.md) preserves the checklist made before completion work. The existing checkout was continued; the simulator and founder documents remain outside this repository.

**Application validation: PASS. Customer deployment readiness: NOT READY.** The implementation builds and the tested renter/lender workflow completes with persistent PostgreSQL data. Real Stripe, email, S3 and GoDaddy services are not configured or certified. No live deployment or real money movement is claimed.

## Completed and verified

| Required feature | Implemented behavior and evidence |
| --- | --- |
| Sign up / login / logout | Persisted accounts and hashed-token sessions; browser registration, logout/login and password reset, including old-session invalidation, passed. |
| Email verification | Expiring hashed one-use links, reset and resend; verified-user gate exercised with captured test emails. Real delivery pending. |
| Renter and lender profiles | One account supports both roles; editable name/bio/area, public listings and received reviews; private identity fields excluded. |
| Create/edit/delete listing | Owner CRUD, administrator moderation, safe soft deletion; open rentals block conflicting edits/deletion and history is retained. |
| Photo uploads | Actual multipart upload, decode/re-encode, ownership metadata and protected delivery; listing and before/after uploads passed with development storage. |
| Availability calendar | Rental date selection, reservations and owner unavailable periods; removal, conflicts and genuine PostgreSQL block/request races tested. |
| Browse/search/filter and details | Real approved inventory, search/category/size/location/date filters, itemized prices, reviews and profiles; browser passed. |
| Rental dates and booking requests | Inclusive dates, immutable server quotes, stored requests and expiry; self/suspended-account/conflict checks tested. |
| Lender accept/decline | Role/state checks and 24-hour approved payment deadline; both browser paths passed, with no charge on decline. |
| Checkout/payment integration | Real Stripe Connect/hosted Checkout and signed webhooks; absent credentials return 503. Exact retries and provider-confirmed states tested with isolated provider double. |
| Persistent booking data | PostgreSQL/Prisma transactions and locks; events, messages, claims, financial IDs and evidence survive reloads. No production seed. |
| Renter/lender dashboards and active rentals | Own/incoming/active rentals, listings, notifications and operations views; both roles traversed in browser. |
| Messaging per booking | Participant/admin scope, stored conversation, 15-second refresh and latest 200 messages; exchange and outsider denial tested. |
| Before/after condition photos | Private immutable reports; lender handover/inspection, renter return evidence, claim-time sealing and access checks tested. |
| Return confirmation | Paid/current-date handover, renter return and lender inspection with evidence and role/state checks; full browser lifecycle passed. |
| Payout state and financial recovery | Deposit refund then connected-account transfer after inspection; lost responses, pending/failed refunds, concurrent retries and duplicate/reordered webhooks tested. A transfer does not claim bank receipt. |
| Claims and expiry recovery | Damage/overdue non-return claims, admin-only deposit-capped resolution including zero-deposit loss, paused missing inventory and expiry notifications tested. |
| Reviews | One review per participant after completion; both submitted and public display checked in browser. |
| Basic notifications | Transactional persisted booking/message updates, unread counts, read-one/read-all and user isolation; browser and rollback tests passed. |
| Deployment preparation | Two PostgreSQL migrations, environment template, explicit admin bootstrap, launch checker, PORT-aware Node server, README and GoDaddy/testing guides. Builds never seed or migrate. |

## Final verification results

| Check | Actual result |
| --- | --- |
| Full service suite, Node.js 22 + native PostgreSQL 16 | **50 passed, 0 failed, 0 skipped.** Includes unit, marketplace/profile/notification/lifecycle and payment recovery tests. |
| Payment subset | **23 passed**, included in the 50 above, not additional; genuine concurrent database calls and injected provider responses. |
| Browser end-to-end, Microsoft Edge | **1 complete multi-role scenario passed** in about 57 seconds; lender/renter/admin/outsider contexts, real HTTP/uploads and separate PostgreSQL database. |
| Browser runtime/mobile | Zero page exceptions; completed booking at 390px had no horizontal overflow; desktop/mobile screenshots inspected. |
| Application and test TypeScript projects | Both passed. |
| Fresh production-only dependency installation | npm ci --omit=dev passed; 0 reported vulnerabilities. Test dependencies are excluded from the application's build typecheck. |
| Production build, Node.js 22 | Both the current checkout and fresh production-only installation passed prisma generate and next build; all application/API routes compiled. |
| Production startup/smoke | PORT 3001 respected; six public routes 200, real database catalogue, auth 401, unconfigured registration/payment 503, security headers and desktop/mobile rendering passed; no browser exceptions. |
| Migration status | Both migrations applied; schema up to date. |
| Dependency audit | npm audit --omit=dev reported 0 known vulnerabilities at verification time. |
| Launch configuration checker | Correctly returned NOT READY for missing live Stripe/email/S3, HTTPS origin, administrator and support/policy configuration. This is an expected external blocker, not a build failure. |

Browser fixes: authenticated profile refresh no longer unmounts its form; direct form controls have explicit accessible labels; the test targets the payment notice rather than Next.js's separate route-announcement alert. The persistent PostgreSQL helper now reuses existing clusters. The former missing stylesheet/booking UI, ignored upload route, inconsistent limits, expiry read models and unsafe payment retries are fixed. No known reproducible failing application test remains.

## Partially completed: external acceptance

- Stripe code is implemented and provider-boundary tested, but no actual account, Connect onboarding, hosted card payment, externally delivered webhook, refund, transfer or bank payout has been exercised.
- Account email flows passed with test-server capture; no verified Resend sender or inbox delivery has been demonstrated.
- Photos passed through actual HTTP and local disk; private S3 permissions, persistence and deployed access remain unverified.
- Migrations/concurrency are verified locally; production PostgreSQL, backups and managed-host Prisma Accelerate transport are not provisioned.
- GoDaddy hosting/domain/HTTPS and operator policies are not configured. Repository delivery is not a live website launch.

## Intentionally deferred and remaining limitations

- Local pickup pilot only. Courier integration, managed cleaning/warehousing, subscriptions, insurance/guaranteed replacement, AI authenticity/damage scoring, native apps and multi-currency are deferred; see [MVP scope](MVP-SCOPE.md).
- Notifications are in-app; email serves account verification/recovery. Push and transactional booking emails are deferred.
- Lost payment disputes, unexpected manual refunds, reversed transfers and PAYMENT_REVIEW require operator reconciliation in Stripe and controlled database operations. No unsafe override or full financial case-management console is provided. Won disputes recover automatically only when Stripe confirms closure and restored principal.
- Pilot result limits: catalogue 60, dashboard 100 bookings/listings, notification list 100, conversation latest 200. Older records remain stored. Expanded pagination/export and automatic retention/cleanup jobs are deferred.
- Verification used Edge/Chromium on Windows. Safari/Firefox/device coverage, load testing and independent penetration testing have not been performed.

## Mocked functionality and security

There is **no mocked account, listing, booking or successful payment in production flows**. The catalogue starts empty. Only tests create fixtures. The Stripe helper rejects real HTTP and is injected only by tests. The explicitly loaded email hook refuses production/non-local/non-test databases and is never imported by the app. Local photo storage and PGlite are development aids; final concurrency tests used native PostgreSQL.

Security controls include scrypt passwords, hashed random tokens, one-time consumption, session revocation, HttpOnly/SameSite cookies with Secure/__Host settings in production, same-origin writes, persistent rate limits, bounded bodies, image re-encoding, private participant evidence/messages, no-store responses, server-enforced prices/roles/states and webhook signature/mode checks. Secrets and local databases are Git-ignored. Production CSP disallows eval but currently permits inline scripts/styles for Next.js; nonce-based CSP and admin MFA remain hardening work. Configure TLS, backups, monitoring and least-privilege provider access before launch.

## Exact launch blockers and hosting requirements

1. Provision GoDaddy **Managed Node.js Hosting** or a **VPS**; static hosting/Website Builder cannot run this app. Use Node.js 22, npm run build, npm start, host-provided PORT and final HTTPS APP_URL.
2. Provision persistent **PostgreSQL**. Managed GoDaddy restricts external database ports, so use compatible **Prisma Accelerate over HTTPS** at runtime and direct PostgreSQL migrations from trusted workstation/CI. A VPS can connect directly and requires proxy/process/firewall/backup management. Verify purchased-plan connectivity.
3. Configure private persistent S3-compatible storage, verified Resend delivery and Stripe platform/Connect credentials plus documented webhook subscriptions.
4. Create the operational admin, finalize operator/support/terms/privacy details and pilot currency/fees, add approved real inventory, and complete deployed provider sandbox acceptance before inviting customers.

Required variables are in [.env.example](../.env.example); [GoDaddy instructions](DEPLOY-GODADDY.md) include constraints and official references, and [testing instructions](TESTING.md) reproduce validation. Do not mark the customer deployment READY until these blockers are resolved. The delivery report supplies the branch and immutable GitHub commit.
