# Local validation

Use Node.js 22 and a full `npm ci` installation. Keep test databases separate from real accounts and rentals. Fixture accounts, listings and financial records are created only by tests and removed by their scoped cleanup; production has no seed or demo-account switch.

## Native PostgreSQL tests

Run `npm run test:postgres` in a separate terminal. It starts persistent PostgreSQL 16 on loopback port 55433 and creates `avielle_test` and `avielle_e2e`. Its fixed `postgres` / `local-test-only` credentials are exclusively for this local test cluster. The cluster lives under ignored `.local/postgres-test`; subsequent runs reuse it. New clusters use UTF-8.

In PowerShell:

```powershell
$env:DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55433/avielle_test'
$env:DIRECT_URL=$env:DATABASE_URL
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:APP_URL='http://localhost:3000'
npm run db:deploy
npm test
npm run typecheck
```

The service suite tests permissions, overlapping reservations, real concurrent booking/blackout requests, expiry, profiles, notifications, claims and financial state transitions. Stripe calls are injected test doubles whose HTTP transport rejects network requests. Scenarios include duplicate/reordered webhooks, exact checkout retries, pending/failed refunds, lost responses, expiry of provider idempotency caches, concurrent settlement and resolved/lost disputes. These tests establish application behavior; they do not establish Stripe account eligibility or real money movement.

## Browser renter/lender workflow

Stop any other application using port 3000. Apply migrations to the separate browser database and start the test server:

```powershell
$env:DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55433/avielle_e2e'
$env:DIRECT_URL=$env:DATABASE_URL
$env:APP_URL='http://localhost:3000'
npm run db:deploy
$env:AVIELLE_E2E='1'
$env:RESEND_API_KEY='e2e-not-live'
$env:EMAIL_FROM='test@avielle.invalid'
$env:STORAGE_DRIVER='local'
Remove-Item Env:STRIPE_SECRET_KEY -ErrorAction SilentlyContinue
Remove-Item Env:STRIPE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
node --require ./tests/e2e/email-hook.cjs ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1
```

In another terminal, set the same `DATABASE_URL`, `DIRECT_URL` and `APP_URL`, then run `npm run test:e2e`. Windows uses installed Microsoft Edge. On Linux/CI, install Chromium with `npx playwright install --with-deps chromium` and set `CI=1`.

The hook captures verification/reset mail under ignored `.local/e2e-mail`; it refuses to run in production or against a non-loopback/non-`_e2e` database. The app itself has no mail outbox fallback. The browser registers/verifies users, resets a password and checks session invalidation, edits both profiles, uploads photos, creates/edits/moderates a listing, manages unavailable dates, searches, requests/declines/accepts bookings, exchanges messages, checks private evidence access, hands over and returns the piece, reviews and reads notifications, and deletes the listing while retaining rental history.

Checkout and settlement first assert the real server's honest 503 when Stripe is absent. Only the separate test worker then injects the provider double to verify persistent payment/refund/transfer state and continue the browser journey. No card checkout page, real email delivery, S3 service or bank payout is certified by this test. Successful browser snapshots are written to ignored `.local/qa`; failures retain traces and screenshots in ignored `test-results`.

The same browser command also runs five dashboard scenarios against genuine, isolated PostgreSQL fixture rows: lender metrics/activity/spotlight and retained management controls; renter metrics, keyboard saving, reload/cross-tab persistence and account isolation; mobile touch scrolling; denied-storage feedback; and reduced-motion behavior. Checks cover metric layout, alternate-image loading, image-motion pause/resume, keyboard tabs, desktop/tablet/mobile page overflow and browser exceptions. Saved pieces are device-local IDs; fixture account/listing data is never seeded in production. Desktop lender and mobile renter captures are saved under `.local/qa/dashboard-*.png` for visual inspection.

Afterward stop this test server and discard its temporary shell environment. Normal `npm run dev` never loads the hook. Never set the test mail credentials in a deployed environment.

Five additional home-page browser scenarios verify the CSS dashboard illustration: actual perspective transforms, scroll chapters and pinning, fine-pointer response, pause/resume, a persistent accessible heading, viewport containment, flat reduced motion, static server HTML with JavaScript disabled, initial CLS below 0.1, and absence of the effect on other routes. They also assert that no canvas or video is introduced. Layout checks use 1440×1000, 768×844, 390×844, 375×667, 1280×640, 320×568 and 812×375; very short viewports use ordinary page flow. These presentation checks create no account, booking or financial data. The preview is explicitly illustrative, with no fictional account metrics or availability. Screenshots are saved under ignored `.local/qa/home-animation-*.png` and `.local/qa/home-dashboard-preview-no-javascript.png`.

For a focused home check against the running local server, use `npm run test:e2e -- tests/e2e/home-animation.spec.ts`. Run the same cases against the production server to verify the server-rendered fallback and packaged styles. Story geometry and chapter-control space are reserved before hydration; the JavaScript-disabled page uses a scoped `noscript` style for ordinary flow. The effect uses event-driven animation frames only while input settles; CSS panel float stops when paused, offscreen, in a hidden tab or under reduced motion. No WebGL assets, external models or animation dependency is needed.

## Production packaging and launch checks

Run `npm run build`, followed by `npm start` with deployment environment values. For GoDaddy packaging, repeat in a fresh source copy with `npm ci --omit=dev`; tests and Playwright configuration are excluded from the application build's TypeScript project and checked separately by `npm run typecheck` in the full development installation.

To repeat only the home presentation cases against the production build, stop the development server, then start production on the browser configuration's port 3000:

```powershell
npm run build
$env:PORT='3000'
npm start
```

In another terminal with the full development dependencies installed, run:

```powershell
npm run test:e2e -- tests/e2e/home-animation.spec.ts
```

This repeats the same five home cases; it adds no test accounts, bookings or financial rows. The complete local browser suite contains 11 cases, so a successful five-case production repeat does not mean there are 16 distinct scenarios. On 8 October all 50 service tests, all 11 browser cases, both TypeScript projects and the Node.js 22 production build passed; the same five home cases then passed in production. Manual coarse-pointer touch/tap and live reduced-motion changes passed, and a separate production desktop PerformanceObserver measurement observed zero layout-shift events.

Run `npm run check:launch` against the intended deployment configuration. Missing hosting, production database/storage, email, Stripe, admin or business-policy settings are deployment blockers, not permission to replace those services with mocks. Then perform real Stripe test-mode checkout/refund/Connect tests, verified email delivery, private S3 access and deployed-host connectivity checks before enabling customers.
