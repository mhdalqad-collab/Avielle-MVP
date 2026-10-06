# Avielle MVP

A real account-based fashion rental marketplace, developed separately from the Dana/Avielle simulator. One account can lend and rent. The catalogue starts empty; only submitted and approved listings appear. There are no switchable demo accounts, simulated payments, fictional ratings or automatically seeded merchandise.

The first release supports registration, verified email, password recovery, editable public profiles, moderated listings and photo uploads, availability calendars and owner date blocks, dated rental requests, owner approval, hosted Stripe checkout, private booking conversations and condition photos, returns, damage/non-return claims, reviews, in-app notifications and provider-backed settlement after inspection. The initial pilot uses local pickup. Insurance, shipping services, subscriptions and warehousing are deferred.

## Run

Use Node.js 22 and npm. Copy `.env.example` to `.env`, supply a **new PostgreSQL database**, and configure the required integrations. Never point this MVP's migrations at the old simulator database.

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

Open http://localhost:3000. Missing email credentials disable registration and recovery; missing Stripe configuration disables payment collection. Missing private storage disables photo uploads. The app never substitutes a successful simulation for an unavailable service.

For offline development only, `npm run db:local` starts a persistent embedded PostgreSQL engine on `127.0.0.1:55432`. Use `postgresql://postgres:postgres@127.0.0.1:55432/avielle_test?connection_limit=1` for both database URLs and `STORAGE_DRIVER=local` for local photo storage. This is a development aid, not a production database or a substitute for PostgreSQL concurrency tests.

## First administrator

Set `ADMIN_EMAIL`, `ADMIN_NAME` and a unique `ADMIN_PASSWORD` of at least 16 characters through your shell's secure environment management, then run `npm run admin:create`. Remove the password variable afterward. The command creates a new administrator and never overwrites an existing account. No default credentials ship with this application.

## Payments

Use a Stripe platform account enabled for Connect and separate charges/transfers. Each lender completes hosted onboarding before a renter can pay. Checkout charges the rental, cleaning, renter fee and refundable deposit together. The deposit is charged money, not an indefinite card authorisation. A verified webhook confirms payment. Return inspection and any resolved claim determine the deposit refund and lender transfer. Payment and payout failures remain recoverable records; a redirect never changes an unpaid booking to paid.

Currency and fees are environment settings. GBP, 18% lender commission and 8% renter fee are provisional defaults from the supplied documents. Confirm them before launch. Provider fees are an operator cost and are not silently added to the customer's quote.

## Verification

```sh
npm test
npm run build
npm run typecheck
npm run check:launch
```

Integration tests require `TEST_DATABASE_URL` pointing to an isolated PostgreSQL test database with migrations applied. CI provisions PostgreSQL 16 and runs these tests on Node.js 22. Tests must never be aimed at production. `check:launch` reports missing live configuration without printing secrets; passing it does not replace live provider testing or business/policy review.

See [reproducible testing instructions](docs/TESTING.md) for the native PostgreSQL service, browser journeys and test-only email/payment adapters. Without `TEST_DATABASE_URL`, database tests are explicitly skipped; that is not a complete validation run. The [implementation audit](docs/IMPLEMENTATION-AUDIT.md) records actual results and remaining launch blockers.

## Deployment

See [GoDaddy deployment](docs/DEPLOY-GODADDY.md) for the managed Node.js and VPS paths. Managed hosting requires Prisma Accelerate's HTTPS connection to PostgreSQL because direct external database connections are restricted. The server respects `PORT`. Builds never migrate or seed data; migrations are an explicit release step.

The application code is not a live launch. Before accepting customers, connect hosting/domain, a persistent database, private S3 storage, verified email delivery and live Stripe/Connect; complete live checkout/refund/payout tests, set the operator/support/policy details and confirm operational responsibilities.

## Product decisions

[MVP scope and document decisions](docs/MVP-SCOPE.md) explains what was used, deferred and changed from the prototype. Original founder documents and old simulator code are not included in this repository. [Photography credits](ASSETS.md) apply to the editorial landing image only, never to actual rental inventory.
