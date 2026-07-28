# Server route table

Generated from the Hono route table by `npx tsx scripts/generate-route-table.mjs`.
Self-authenticating routes enforce a session, API key, or operator secret before the shared tenant identity middleware.

| Route | Access | Operation | Purpose |
|---|---|---|---|
| `GET /api/health/live` | public | read | Process liveness check |
| `GET /api/health/ready` | public | read | Database readiness check |
| `GET /api/health` | public | read | Runtime health check |
| `OPTIONS /api/public/offer` | public | read | Public offer discovery |
| `OPTIONS /api/public/payment-config` | public | read | Checkout capability discovery |
| `OPTIONS /api/public/checkout/coupon` | public | read | Read-only coupon validation |
| `OPTIONS /api/public/checkout/session` | public | read | Checkout session start preflight |
| `OPTIONS /api/public/auth-config` | public | read | Login capability discovery |
| `GET /api/public/offer` | public | read | Public offer discovery |
| `GET /api/public/payment-config` | public | read | Checkout capability discovery |
| `POST /api/public/checkout/coupon` | public | read | Read-only coupon validation |
| `POST /api/public/checkout/session` | public | mutating | Checkout session start |
| `GET /api/public/auth-config` | public | read | Login capability discovery |
| `POST /api/auth/sign-in/magic-link` | public | mutating | Login, recovery, and magic-link authentication surface |
| `POST /api/auth/request-password-reset` | public | mutating | Login, recovery, and magic-link authentication surface |
| `GET /api/auth/*` | public | read | Authentication callbacks and session reads |
| `POST /api/auth/*` | public | mutating | Login, recovery, and magic-link authentication surface |
| `POST /api/webhooks/ses/:webhookToken` | public | mutating | Amazon SNS delivery webhook |
| `POST /u/:token` | public | mutating | Unsubscribe preference changes |
| `POST /u/:token/confirm` | public | mutating | Unsubscribe preference changes |
| `POST /u/:token/all` | public | mutating | Unsubscribe preference changes |
| `POST /u/:token/preferences` | public | mutating | Unsubscribe preference changes |
| `GET /u/:token` | public | read | Unsubscribe preference page |
| `GET /marketing/confirm/:token` | public | read | Double opt-in confirmation page |
| `POST /marketing/confirm/:token` | public | mutating | Double opt-in confirmation |
| `GET /legal/:slug` | public | read | Latest public legal document |
| `GET /legal/:slug/v/:version` | public | read | Versioned public legal document |
| `POST /api/webhooks/stripe/:tenantId` | public | mutating | Stripe payment webhook |
| `POST /api/internal/dispatch-email` | self-authenticating | mutating | email dispatch |
| `POST /api/internal/dispatch-ksef` | self-authenticating | mutating | ksef dispatch |
| `GET /api/internal/dispatch-ksef` | self-authenticating | read | api internal dispatch-ksef |
| `GET /api/internal/scheduler-runs` | self-authenticating | read | global scheduler runs |
| `GET /api/internal/scheduler-runs/:id` | self-authenticating | read | global scheduler run |
| `POST /api/public/terms-consent` | self-authenticating | mutating | terms consent |
| `POST /api/tenants` | self-authenticating | mutating | tenants create |
| `POST /api/dev/simulate-purchase` | development-only | mutating | dev simulate purchase |
| `GET /api/dev/magic-link` | development-only | read | dev magic link |
| `GET /api/dev/email` | development-only | read | dev email |
| `POST /api/dev/grant` | development-only | mutating | dev grant |
| `POST /api/dev/subscriptions/simulate-cycle` | development-only | mutating | dev subscription simulate cycle |
| `POST /api/dev/subscriptions/simulate-failure` | development-only | mutating | dev subscription simulate failure |
| `POST /api/m2m/enroll` | self-authenticating | mutating | m2m enroll |
| `POST /api/m2m/marketing/messages` | self-authenticating | mutating | marketing messages create |
| `GET /api/m2m/marketing/eligibility` | self-authenticating | read | marketing eligibility |
| `POST /api/m2m/marketing/consents` | self-authenticating | mutating | marketing consents |
| `GET /api/m2m/marketing/suppressions` | self-authenticating | read | marketing suppressions |
| `POST /api/m2m/marketing/suppressions` | self-authenticating | mutating | marketing suppressions create |
| `GET /api/m2m/marketing/messages` | self-authenticating | read | marketing messages |
| `GET /api/m2m/marketing/messages/:id` | self-authenticating | read | marketing message |
| `GET /api/m2m/marketing/consent-definitions` | self-authenticating | read | api m2m marketing consent-definitions |
| `GET /api/m2m/marketing/templates` | self-authenticating | read | marketing templates |
| `POST /api/internal/marketing/tick` | self-authenticating | mutating | marketing tick |
| `GET /api/internal/marketing/tick` | self-authenticating | read | api internal marketing tick |
| `GET /api/marketing/consent-definitions` | authenticated | read | marketing consent definitions |
| `GET /api/marketing/scheduler-runs` | authenticated | read | tenant scheduler runs |
| `GET /api/marketing/scheduler-runs/:id` | authenticated | read | tenant scheduler run |
| `POST /api/marketing/consent-definitions` | authenticated | mutating | marketing consent definitions create |
| `GET /api/marketing/consent-definitions/:id` | authenticated | read | marketing consent definition |
| `POST /api/marketing/consent-definitions/update` | authenticated | mutating | marketing consent definition update |
| `GET /api/marketing/campaigns` | authenticated | read | marketing campaigns |
| `POST /api/marketing/campaigns` | authenticated | mutating | marketing campaigns create |
| `POST /api/marketing/campaigns/schedule` | authenticated | mutating | marketing campaign schedule |
| `GET /api/marketing/campaigns/:id` | authenticated | read | marketing campaign |
| `POST /api/marketing/campaigns/update` | authenticated | mutating | marketing campaign update |
| `POST /api/marketing/campaigns/action` | authenticated | mutating | marketing campaign action |
| `POST /api/marketing/campaigns/test` | authenticated | mutating | marketing campaign test |
| `POST /api/marketing/audience-preview` | authenticated | mutating | marketing audience preview |
| `GET /api/marketing/documents` | authenticated | read | marketing documents |
| `POST /api/marketing/documents` | authenticated | mutating | marketing documents create |
| `GET /api/marketing/documents/:id` | authenticated | read | marketing document |
| `POST /api/marketing/documents/update` | authenticated | mutating | marketing document update |
| `POST /api/marketing/documents/publish` | authenticated | mutating | marketing document publish |
| `GET /api/marketing/layouts` | authenticated | read | marketing layouts |
| `POST /api/marketing/layouts` | authenticated | mutating | marketing layouts save |
| `GET /api/marketing/ses-settings` | authenticated | read | marketing ses settings |
| `GET /api/marketing/reputation` | authenticated | read | marketing reputation |
| `POST /api/marketing/ses-settings` | authenticated | mutating | marketing ses settings update |
| `POST /api/marketing/ses-onboarding/poll` | authenticated | mutating | marketing ses onboarding |
| `POST /api/marketing/ses-onboarding/identity` | authenticated | mutating | marketing ses identity start |
| `POST /api/marketing/ses-onboarding/infrastructure` | authenticated | mutating | marketing ses provision |
| `POST /api/marketing/ses-onboarding/simulator` | authenticated | mutating | marketing ses simulator |
| `POST /api/marketing/smtp/test` | authenticated | mutating | marketing smtp test |
| `GET /api/marketing/suppressions` | authenticated | read | marketing staff suppressions |
| `GET /api/marketing/sends/export` | authenticated | read | email sends export |
| `GET /api/marketing/sends` | authenticated | read | email sends |
| `GET /api/marketing/sends/:kind/:id` | authenticated | read | email send |
| `GET /api/members/:id/emails` | authenticated | read | member email sends |
| `POST /api/marketing/suppressions` | authenticated | mutating | marketing staff suppressions create |
| `GET /api/me` | authenticated | read | me |
| `GET /api/me/billing-orders` | authenticated | read | member billing orders |
| `GET /api/me/data-export` | authenticated | read | member data export |
| `GET /api/me/erasure-request` | authenticated | read | member erasure request |
| `POST /api/me/erasure-request` | authenticated | mutating | member erasure request create |
| `DELETE /api/me/erasure-request` | authenticated | mutating | member erasure request cancel |
| `GET /api/members/erasure-requests` | authenticated | read | member erasure requests |
| `POST /api/members/erasure-requests/:requestId/reject` | authenticated | mutating | member erasure reject |
| `GET /api/tenants` | authenticated | read | tenants |
| `GET /api/products` | authenticated | read | products |
| `GET /api/my/products` | authenticated | read | my products |
| `GET /api/members` | authenticated | read | members |
| `GET /api/members/export` | authenticated | read | members export |
| `GET /api/members/:memberId/grants` | authenticated | read | member grants |
| `GET /api/members/:memberId/learning-summary` | authenticated | read | member learning summary |
| `POST /api/members/:memberId/progress-reset` | authenticated | mutating | member progress reset |
| `DELETE /api/members/:memberId` | authenticated | mutating | member remove |
| `POST /api/grants` | authenticated | mutating | grants create |
| `DELETE /api/grants/:grantId` | authenticated | mutating | grant revoke |
| `GET /api/api-keys` | authenticated | read | api keys |
| `POST /api/api-keys` | authenticated | mutating | api keys create |
| `DELETE /api/api-keys/:id` | authenticated | mutating | api key revoke |
| `GET /api/tenant-secrets` | authenticated | read | tenant secrets |
| `POST /api/tenant-secrets` | authenticated | mutating | tenant secret set |
| `DELETE /api/tenant-secrets/:key` | authenticated | mutating | tenant secret delete |
| `GET /api/tenant/settings` | authenticated | read | tenant settings |
| `POST /api/tenant/settings` | authenticated | mutating | tenant settings update |
| `GET /api/onboarding` | authenticated | read | onboarding |
| `POST /api/onboarding/dismiss` | authenticated | mutating | onboarding dismiss |
| `POST /api/integrations/stripe/test` | authenticated | mutating | stripe test connection |
| `POST /api/integrations/ifirma/test` | authenticated | mutating | ifirma test connection |
| `POST /api/integrations/ksef/test` | authenticated | mutating | ksef test connection |
| `GET /api/integrations/bunny/videos` | authenticated | read | bunny videos |
| `POST /api/integrations/bunny/test` | authenticated | mutating | bunny test connection |
| `POST /api/products` | authenticated | mutating | products create |
| `POST /api/products/publish` | authenticated | mutating | products publish |
| `POST /api/products/access-items` | authenticated | mutating | products access items |
| `GET /api/products/access-issues` | authenticated | read | products access issues |
| `GET /api/products/:productId/prices` | authenticated | read | product prices |
| `POST /api/products/prices` | authenticated | mutating | product prices create |
| `POST /api/products/prices/deactivate` | authenticated | mutating | product price deactivate |
| `GET /api/orders` | authenticated | read | orders |
| `GET /api/orders/reconciliation` | authenticated | read | orders reconciliation |
| `GET /api/orders/export` | authenticated | read | orders export |
| `GET /api/orders/:orderId` | authenticated | read | order |
| `POST /api/orders/:orderId/invoice` | authenticated | mutating | invoice issue |
| `POST /api/invoices/:invoiceId/refresh` | authenticated | mutating | invoice refresh |
| `GET /api/invoices/:invoiceId/download` | authenticated | read | invoice download |
| `GET /api/invoices/:invoiceId/upo` | authenticated | read | invoice upo download |
| `GET /api/me/invoices/:invoiceId/download` | authenticated | read | member invoice download |
| `GET /api/sales/summary` | authenticated | read | sales summary |
| `GET /api/coupons/export` | authenticated | read | coupon stats export |
| `POST /api/coupons/archive` | authenticated | mutating | coupon archive |
| `GET /api/coupons/options` | authenticated | read | coupon options |
| `GET /api/coupons` | authenticated | read | coupon stats |
| `POST /api/coupons` | authenticated | mutating | coupons create |
| `GET /api/coupons/:couponId` | authenticated | read | coupon stats detail |
| `GET /api/courses` | authenticated | read | courses |
| `POST /api/courses` | authenticated | mutating | courses create |
| `POST /api/courses/update` | authenticated | mutating | courses update |
| `GET /api/courses/history/version` | authenticated | read | courses history version |
| `GET /api/courses/history` | authenticated | read | courses history |
| `GET /api/modules` | authenticated | read | modules |
| `POST /api/modules` | authenticated | mutating | modules create |
| `POST /api/modules/update` | authenticated | mutating | modules update |
| `POST /api/modules/attach` | authenticated | mutating | modules attach |
| `POST /api/modules/detach` | authenticated | mutating | modules detach |
| `GET /api/lessons` | authenticated | read | lessons |
| `POST /api/lessons` | authenticated | mutating | lessons create |
| `POST /api/lessons/update` | authenticated | mutating | lessons update |
| `GET /api/lessons/references` | authenticated | read | lesson references |
| `DELETE /api/lessons/:lessonId` | authenticated | mutating | lessons delete |
| `GET /api/student/courses` | authenticated | read | student courses |
| `GET /api/student/courses/:courseId/structure` | authenticated | read | student course structure |
| `POST /api/student/lessons/complete` | authenticated | mutating | student lesson complete |
| `POST /api/student/lessons/uncomplete` | authenticated | mutating | student lesson uncomplete |
| `POST /api/student/progress/last-viewed` | authenticated | mutating | student last viewed |
| `GET /api/student/lessons/next` | authenticated | read | student lesson next |
| `GET /api/student/progress` | authenticated | read | student progress |
| `GET /api/student/lessons/:lessonId` | authenticated | read | student lesson |
| `POST /api/posts` | authenticated | mutating | posts create |
| `POST /api/support/message` | authenticated | mutating | support message |
| `POST /api/posts/pin` | authenticated | mutating | posts pin |
| `POST /api/posts/update` | authenticated | mutating | posts update |
| `DELETE /api/posts/:postId` | authenticated | mutating | posts delete |
| `GET /api/discussion` | authenticated | read | discussion |
| `POST /api/discussion/subscribe` | authenticated | mutating | thread subscribe |
| `POST /api/discussion/mute` | authenticated | mutating | thread mute |
| `GET /api/posts/search` | authenticated | read | posts search |
| `POST /api/posts/react` | authenticated | mutating | posts react |
| `POST /api/posts/unreact` | authenticated | mutating | posts unreact |
| `GET /api/spaces` | authenticated | read | spaces |
| `GET /api/spaces/staff` | authenticated | read | spaces staff |
| `POST /api/spaces/archive` | authenticated | mutating | spaces archive |
| `POST /api/spaces` | authenticated | mutating | spaces create |
| `POST /api/spaces/update` | authenticated | mutating | spaces update |
| `DELETE /api/spaces/:spaceId` | authenticated | mutating | spaces delete |
| `GET /api/spaces/:spaceId/feed` | authenticated | read | space feed |
| `POST /api/spaces/follow` | authenticated | mutating | space follow |
| `POST /api/spaces/unfollow` | authenticated | mutating | space unfollow |
| `GET /api/notifications` | authenticated | read | notifications |
| `POST /api/notifications/read` | authenticated | mutating | notification read |
| `POST /api/notifications/read-all` | authenticated | mutating | notifications read all |
| `GET /api/notifications/unread-count` | authenticated | read | notifications unread |
| `GET /api/notifications/stream` | authenticated | read | notifications stream |
| `GET /*` | public | read | Tenant social preview for link crawlers |
