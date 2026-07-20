const external = 'node_modules';
const coreDomainExternal = 'node_modules/zod(/|$)';
const coreContractExternal = 'node_modules/zod(/|$)';
const coreClientExternal = 'node_modules/(@tanstack/query-core|zod)(/|$)';
const coreClientTestExternal = 'node_modules/(@tanstack/query-core|zod|vitest)(/|$)';
const coreServerTestExternal = 'node_modules/vitest(/|$)';
const adapterDbExternal = 'node_modules/(@neondatabase/serverless|drizzle-orm|pg)(/|$)';
const adapterDbTestExternal = 'node_modules/(@neondatabase/serverless|drizzle-orm|pg|vitest)(/|$)';
const adapterAuthExternal = 'node_modules/(@better-auth/passkey|better-auth|drizzle-orm|pg|zod)(/|$)';
const adapterAuthTestExternal =
  'node_modules/(@better-auth/passkey|better-auth|drizzle-orm|pg|vitest|zod)(/|$)';
const adapterEmailExternal = 'node_modules/@aws-sdk/client-ses(/|$)';
const adapterEmailTestExternal = 'node_modules/(@aws-sdk/client-ses|vitest)(/|$)';
const adapterCryptoExternal = 'node_modules/zod(/|$)';
const adapterCryptoTestExternal = 'node_modules/vitest(/|$)';
const adapterPaymentExternal = 'node_modules/stripe(/|$)';
const adapterPaymentTestExternal = 'node_modules/(stripe|vitest)(/|$)';
const adapterVideoExternal = 'node_modules/zod(/|$)';
const adapterVideoTestExternal = 'node_modules/(vitest|zod)(/|$)';
const adapterNotificationsTestExternal = 'node_modules/vitest(/|$)';
const adapterStorageTestExternal = 'node_modules/vitest(/|$)';
const coreDomainTestExternal = 'node_modules/(vitest|zod)(/|$)';
const coreContractTestExternal = 'node_modules/(vitest|zod)(/|$)';
const appCliTestExternal = 'node_modules/vitest(/|$)';
const appServerExternal =
  'node_modules/(@hono/node-server|@opentelemetry/(api|exporter-trace-otlp-http|resources|sdk-trace-base|sdk-trace-node|semantic-conventions)|hono|vitest|zod)(/|$)';
const webExternal =
  'node_modules/(@fontsource/(fraunces|inter|jetbrains-mono|manrope|space-grotesk)|@mui/material|@opentelemetry/api|@sentry/react|@tanstack/react-query|@tanstack/react-query-devtools|@tanstack/react-router|@testing-library/(jest-dom|react|user-event)|@vitejs/plugin-react|dompurify|msw|react|react-dom|vite|vitest)(/|$)';
const cliExternal = 'node_modules/(commander|zod)(/|$)';
const scriptsExternal =
  'node_modules/(@core/(contract|domain)|@adapters/(auth|db)|axe-core|mongodb|otplib|pg|pixelmatch|playwright-core|pngjs|zod)(/|$)';
const scriptsTestExternal =
  'node_modules/(@core/(contract|domain)|@adapters/(auth|db)|vitest|zod)(/|$)';

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'core-domain-depends-on-nothing',
      severity: 'error',
      from: { path: '^core/domain' },
      to: { path: '^(core/(contract|server|client)|adapters|apps)' },
    },
    {
      name: 'core-server-pure',
      severity: 'error',
      from: { path: '^core/server' },
      to: { path: '^(core/(contract|client)|adapters|apps)' },
    },
    {
      name: 'core-contract-only-domain',
      severity: 'error',
      from: { path: '^core/contract' },
      to: { path: '^(core/(server|client)|adapters|apps)' },
    },
    {
      name: 'core-client-never-server-side',
      severity: 'error',
      from: { path: '^core/client' },
      to: { path: '^(core/server|adapters|apps)' },
    },
    {
      name: 'adapters-never-import-apps',
      severity: 'error',
      from: { path: '^adapters' },
      to: { path: '^apps' },
    },
    {
      name: 'web-never-server-side',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^(core/server|adapters/db|adapters/domain-provisioning|apps/(server|cli))' },
    },
    {
      name: 'web-layout-structure-only',
      severity: 'error',
      comment:
        'Layout primitives carry structure only: theme atoms in, feature data / api / i18n / core out (ux-layout-system §5.3)',
      from: { path: '^apps/web/src/components/layout' },
      to: {
        path: '^(core/|adapters/|apps/web/src/(features/|routes/|i18n/|api\\.ts|NotificationBell))',
      },
    },
    {
      name: 'cli-is-a-pure-api-client',
      severity: 'error',
      from: { path: '^apps/cli' },
      to: { path: '^(core/server|adapters/(db|domain-provisioning)|apps/(server|web))' },
    },
    {
      name: 'vercel-and-neon-only-in-adapters',
      severity: 'error',
      comment: 'Zero platform lock-in in core and apps (PRD: Goals)',
      from: { pathNot: '^(adapters|apps/server/src/entry\\.vercel\\.ts)' },
      to: { path: 'node_modules/(@vercel|@neondatabase)' },
    },
    {
      name: 'no-frameworks-in-core',
      severity: 'error',
      from: { path: '^core' },
      to: { path: 'node_modules/(hono|react|react-dom|drizzle-orm|better-auth|pg|commander)(/|$)' },
    },
    {
      name: 'core-domain-external-allowlist',
      severity: 'error',
      from: { path: '^core/domain', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreDomainExternal },
    },
    {
      name: 'core-domain-test-external-allowlist',
      severity: 'error',
      from: { path: '^core/domain/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreDomainTestExternal },
    },
    {
      name: 'core-contract-external-allowlist',
      severity: 'error',
      from: { path: '^core/contract', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreContractExternal },
    },
    {
      name: 'core-contract-test-external-allowlist',
      severity: 'error',
      from: { path: '^core/contract/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreContractTestExternal },
    },
    {
      name: 'core-client-external-allowlist',
      severity: 'error',
      from: { path: '^core/client', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreClientExternal },
    },
    {
      name: 'core-client-test-external-allowlist',
      severity: 'error',
      from: { path: '^core/client/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreClientTestExternal },
    },
    {
      name: 'core-server-external-allowlist',
      severity: 'error',
      from: { path: '^core/server', pathNot: '\\.test\\.tsx?$' },
      to: { path: external },
    },
    {
      name: 'core-server-test-external-allowlist',
      severity: 'error',
      from: { path: '^core/server/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: coreServerTestExternal },
    },
    {
      name: 'adapter-db-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/db', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterDbExternal },
    },
    {
      name: 'adapter-db-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/db/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterDbTestExternal },
    },
    {
      name: 'adapter-auth-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/auth', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterAuthExternal },
    },
    {
      name: 'adapter-auth-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/auth/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterAuthTestExternal },
    },
    {
      name: 'adapter-email-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/email', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterEmailExternal },
    },
    {
      name: 'adapter-email-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/email/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterEmailTestExternal },
    },
    {
      name: 'adapter-crypto-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/crypto', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterCryptoExternal },
    },
    {
      name: 'adapter-crypto-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/crypto/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterCryptoTestExternal },
    },
    {
      name: 'adapter-payment-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/payment', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterPaymentExternal },
    },
    {
      name: 'adapter-payment-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/payment/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterPaymentTestExternal },
    },
    {
      name: 'adapter-video-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/video', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterVideoExternal },
    },
    {
      name: 'adapter-video-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/video/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterVideoTestExternal },
    },
    {
      name: 'adapter-notifications-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/notifications', pathNot: '\\.test\\.tsx?$' },
      to: { path: external },
    },
    {
      name: 'adapter-notifications-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/notifications/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterNotificationsTestExternal },
    },
    {
      name: 'adapter-storage-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/storage', pathNot: '\\.test\\.tsx?$' },
      to: { path: external },
    },
    {
      name: 'adapter-storage-test-external-allowlist',
      severity: 'error',
      from: { path: '^adapters/storage/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: adapterStorageTestExternal },
    },
    {
      name: 'app-server-external-allowlist',
      severity: 'error',
      from: { path: '^apps/server' },
      to: { path: external, pathNot: appServerExternal },
    },
    {
      name: 'app-web-external-allowlist',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: external, pathNot: webExternal },
    },
    {
      name: 'app-cli-external-allowlist',
      severity: 'error',
      from: { path: '^apps/cli', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: cliExternal },
    },
    {
      name: 'app-cli-test-external-allowlist',
      severity: 'error',
      from: { path: '^apps/cli/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: appCliTestExternal },
    },
    {
      name: 'scripts-external-allowlist',
      severity: 'error',
      from: { path: '^scripts', pathNot: '\\.test\\.tsx?$' },
      to: { path: external, pathNot: scriptsExternal },
    },
    {
      name: 'scripts-test-external-allowlist',
      severity: 'error',
      from: { path: '^scripts/.*\\.test\\.tsx?$' },
      to: { path: external, pathNot: scriptsTestExternal },
    },
    {
      name: 'web-ui-is-presentational',
      severity: 'error',
      comment: 'components/ui: no core, adapters, features, routes or TanStack (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/components/ui' },
      to: {
        path: '^(core|adapters|apps/web/src/(features|routes))|node_modules/@tanstack/react-(query|router)(/|$)',
      },
    },
    {
      name: 'web-lib-no-react',
      severity: 'error',
      comment: 'lib is pure TypeScript: no react (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/lib' },
      to: { path: 'node_modules/(react|react-dom)(/|$)' },
    },
    {
      name: 'web-lib-has-no-app-internal-deps',
      severity: 'error',
      comment: 'lib is a pure utility leaf: no app-internal imports (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/lib' },
      to: { path: '^(core|adapters|apps)', pathNot: '^apps/web/src/lib' },
    },
    {
      name: 'web-routes-stay-thin',
      severity: 'error',
      comment: 'routes render features only: no core, adapters or api wiring (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/routes' },
      to: { path: '^(core|adapters)|^apps/web/src/api\\.' },
    },
    {
      name: 'web-features-consume-bound-actions',
      severity: 'error',
      comment:
        'features consume bound actions from api.ts, never adapters directly (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/features' },
      to: { path: '^adapters' },
    },
    {
      name: 'web-features-are-islands',
      severity: 'error',
      comment:
        'a feature imports only itself, never a sibling feature (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/([^/]+)/',
        pathNot: '^apps/web/src/features/$1/',
      },
    },
    {
      name: 'web-api-is-the-only-client-construction-site',
      severity: 'error',
      comment:
        'api.ts is the only web module besides main.tsx that binds adapters (frontend-lint-plan Phase 2)',
      from: {
        path: '^apps/web/src',
        pathNot: '^apps/web/src/(api\\.ts|main\\.tsx)',
      },
      to: { path: '^adapters/auth' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^apps/web/src/stories/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
