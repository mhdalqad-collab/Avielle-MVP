# Deploy Avielle on GoDaddy

Deployment reference checked against official documentation on 6 October 2026. This guide describes the required setup; it is not a record of a successful deployment. The repository contains application code, not provisioned hosting, live credentials or customer inventory.

## Choose the correct hosting product

Avielle needs a running Node.js application, PostgreSQL and external services. Uploading its files to an ordinary static website directory or Website Builder cannot run the application.

| GoDaddy option | Database connection | Additional responsibility |
| --- | --- | --- |
| Managed Node.js Hosting | Prisma Accelerate over HTTPS, backed by PostgreSQL | Configure the HTTPS database connection and verify it from GoDaddy's preview environment. Run database migrations from a separate trusted machine or CI runner with direct PostgreSQL access. |
| GoDaddy VPS | Direct PostgreSQL, or Accelerate if desired | Operate Node.js 22, a process supervisor, an HTTPS reverse proxy, firewall rules, backups and updates. Test connectivity to the chosen database. |

GoDaddy's managed service runs Node.js 22 and supports Next.js, GitHub connections, private previews and custom domains. A published app requires an eligible hosting subscription. A domain registration alone is insufficient. See [GoDaddy Node.js Hosting](https://www.godaddy.com/en-in/hosting/nodejs) and [attaching a hosting plan](https://developer.godaddy.com/en/docs/api-users/hosting/attach-hosting-plan).

**Managed-host database constraint:** GoDaddy's official deployment contract allows outbound HTTP on port 80, HTTPS on port 443 and its own managed MySQL. It states that external databases on other ports are unreachable. A normal `postgresql://...:5432/...` runtime URL therefore does not fit this hosting profile. The included MySQL service is not a replacement for this application's PostgreSQL schema. See [GoDaddy's deployment contract, C11 and C12](https://github.com/godaddy/nodejs-hosting-agent-skill/blob/main/skills/godaddy-nodejs-hosting/contract.md).

## Application packaging

Deploy the contents of this repository as one application. The project root must contain `package.json` and `package-lock.json`; do not wrap them inside an extra directory in an upload. The application uses:

```text
Node.js: 22.x
Build: npm run build
Start: npm start
```

The build generates the Prisma client and compiles Next.js. Production startup must use the assigned `PORT`; do not add a fixed production port. Keep every dependency needed for the build or server in `dependencies`, including the Prisma CLI/client, TypeScript and necessary types. GoDaddy installs production dependencies before building. `devDependencies` are available only in the separate development/test environment. See [GoDaddy application requirements](https://developer.godaddy.com/en/docs/api-users/hosting/app-requirements).

Retain the public npm registry setting in `.npmrc` and the lockfile. Include source, migrations, application assets and configuration templates. Exclude `.env` secrets, `node_modules`, `.next`, caches, local databases, original founder documents and the old simulator. A ZIP must stay below GoDaddy's documented 100 MB limit. The Help Center also calls for a valid `main` entry as well as `build` and `start`; check the final manifest against the platform validation. See [GoDaddy upload guidance](https://www.godaddy.com/en-ca/help/upload-my-ai-generated-app-to-godaddy-nodejs-hosting-42987).

Rehearse the production install/build/start sequence in a fresh checkout using the committed lockfile:

```sh
npm ci --omit=dev
npm run build
npm start
```

Use the host's environment configuration for secrets. Never place a real environment file in GitHub or in the source archive.

## PostgreSQL and Prisma Accelerate

For managed Node.js Hosting, provision PostgreSQL and enable Prisma Accelerate for that database. The server's `DATABASE_URL` must be the generated `prisma://` Accelerate URL. Treat its API key as a secret. Keep `DIRECT_URL` as a separate direct PostgreSQL URL for migrations; its schema configuration does not imply that GoDaddy can reach it.

This repository uses Prisma ORM 6.12. The compatible client pattern is `new PrismaClient().$extends(withAccelerate())` when Accelerate is selected. Ordinary PostgreSQL connections remain suitable for the VPS/local profile. Avoid copying the Prisma ORM 7-only constructor or configuration pattern into this version. The official [Prisma ORM 6 overview](https://www.prisma.io/docs/orm/v6/overview/beyond-prisma-orm) shows the extension pattern. Prisma documents automatic detection of `prisma://` from version 5.2, interactive transaction support from 5.1.1, and normal client generation for persistent servers in [Accelerate setup](https://docs.prisma.io/docs/accelerate/getting-started).

The HTTPS route addresses the documented network restriction, but it still requires a deployed smoke test with the real service configuration. Leave booking, availability, financial and private account queries uncached. Check the purchased Accelerate plan's query and transaction limits against the booking workflow. Do not add caching merely to make the integration work. See [Accelerate FAQ](https://www.prisma.io/docs/v6/accelerate/faq).

## Required configuration and external accounts

Use `.env.example` as the authoritative list of variable names. Supply separate test and production values in their respective hosting environments.

| Service | Required setup |
| --- | --- |
| Application | `APP_URL` set to the final HTTPS origin; `NODE_ENV=production`; currency and fee settings confirmed. The host supplies `PORT`. |
| PostgreSQL | `DATABASE_URL` for the selected runtime transport and `DIRECT_URL` for the migration runner. Use persistent storage, backups and access limited to the intended clients. |
| Photo storage | A private S3-compatible bucket, region, HTTPS endpoint where applicable and restricted credentials for the app's bucket. Listing photos and private rental evidence must survive deployments. Do not use the app container as permanent storage. |
| Email | A verified sender/domain plus `RESEND_API_KEY` and `EMAIL_FROM`. This app uses Resend's HTTPS API. Verify email delivery from the deployed host; password recovery and email verification depend on it. |
| Payments | Stripe platform account with Connect enabled, `STRIPE_SECRET_KEY`, the endpoint's `STRIPE_WEBHOOK_SECRET`, and completed onboarding for each owner receiving funds. |
| Business settings | `CURRENCY=gbp`, `COMMISSION_BPS=1800` and `RENTER_FEE_BPS=800` are the pilot defaults. Confirm final fees, operator identity, support contact and customer-facing policies before taking bookings. |

The GoDaddy contract describes a built-in email gateway and prohibits outbound SMTP. This application currently uses an external HTTPS mail integration; no SMTP configuration is needed. If the chosen plan requires its gateway, adapt `lib/mail.ts` and verify the authentication and recovery flows before enabling customer accounts. See [GoDaddy email integration](https://github.com/godaddy/nodejs-hosting-agent-skill/blob/main/skills/godaddy-nodejs-hosting/email.md), [Resend API authentication](https://resend.com/docs/api-reference/introduction) and [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction).

Do not enable payments merely because keys exist. Stripe must accept the platform configuration, each owner must be eligible to receive transfers, and the webhook must reach the correct deployment. The integration uses separate charges and transfers, not a claimed regulated escrow product. Provider fees, account eligibility, balance availability and refunds remain real operational requirements. See [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) and [Stripe webhook configuration](https://docs.stripe.com/webhooks).

## Explicit schema migration

Database changes are an operator-controlled release step. Neither application startup nor normal build should reset, seed or migrate a production database automatically.

1. Back up an existing database and check the migrations included in the release.
2. On a trusted workstation or release runner that can reach PostgreSQL, load the correct environment securely. For managed GoDaddy, do this outside its restricted container.
3. Run the committed production migration command:

```sh
npm run db:deploy
```

4. Confirm migration status and test the application against the intended database before publishing.

Use `prisma migrate deploy` through the script above, not `migrate dev`, `db push`, `migrate reset` or an automatic demo seed in production. Prisma documents the deployment workflow in [production migration guidance](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production).

Create the initial administrator deliberately using the supplied admin setup script and secure environment values; inspect that script for its required inputs. There are no default credentials or automatic sample accounts. Owners must create actual listings and an administrator must approve them.

## Connect GitHub and verify the release

1. Connect the intended branch of [Avielle-MVP on GitHub](https://github.com/mhdalqad-collab/Avielle-MVP) in the GoDaddy Node.js Hosting UI. Review deploy-on-push behavior before using the branch for live releases.
2. Configure preview secrets using a separate database, storage and Stripe test configuration. Do not use production customer data in the preview.
3. Apply the preview database migrations explicitly, deploy and inspect build/server logs. Verify the assigned port and every external service connection.
4. Configure the final HTTPS domain and production secrets. Apply production migrations, then publish the approved release. Update `APP_URL` and the Stripe endpoint for that domain.
5. Configure the webhook URL as `https://YOUR-DOMAIN/api/payments/webhook` and subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `account.updated`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated`. Obtain the signing secret for this exact endpoint. Connect account updates must be delivered for the connected accounts too. Test replay handling and failed/late payment recovery. A successful checkout redirect alone does not confirm payment.

Checkout uses cards and a 31-minute session. The renter must start at least 31 minutes before the 24-hour approval deadline; retries keep the original session parameters and never extend a reservation. Successful return settlement means a transfer to the lender's connected Stripe balance, not confirmed arrival in their bank. Stripe controls subsequent bank payout timing. Lost disputes, unexpected manual refunds, reversed transfers and `PAYMENT_REVIEW` require operator reconciliation; do not clear those holds by editing statuses without reconciling Stripe records. Won disputes resume automatically only after Stripe reports closed disputes and restored principal.

Use a full development installation to run the repository's checks before release. Keep any local test database and test fixtures isolated from the launch environment. In the deployed preview, verify registration and mail links, owner onboarding, photo access, listing approval, overlapping booking rejection, itemized checkout, cancellation/refund, condition evidence, return/inspection, claim resolution and settlement. Verify authorization with two different accounts as well as the administrator.

For a VPS deployment, run the same release under a supervised Node.js 22 process behind HTTPS, set the assigned service port through the environment, and make the proxy preserve the intended origin and secure-cookie behavior. Configure database/storage backups and a restart policy. Root-level VPS access and server management differ from managed Node.js Hosting; GoDaddy describes the distinction in its [hosting FAQ](https://www.godaddy.com/en-ph/help/godaddy-nodejs-hosting-faq-42915).

Publishing requires the user's actual hosting access, chosen domain and configured external accounts. Repository delivery and local validation do not establish live deployment, successful real payments or verified delivery of production emails.
