# Google social sign-in — manual smoke

Google is the one auth method the PoC cannot exercise end to end headlessly: it
needs a real OAuth consent screen. It is therefore **env-gated**, and the consent
screen is verified by hand. Passkeys and TOTP 2FA are covered automatically by
`pnpm run e2e:auth`; the two-factor challenge after a Google sign-in is covered by
`pnpm run e2e:two-factor` against a test-only Google fake (below).

## What the two-factor suite covers

`scripts/two-factor-e2e.ts` signs the seeded acme creator, enrolled in TOTP by the
same suite, in through Google twice, starting from
`/login?returnTo=/account?tab=security` on `http://acme.localhost:<port>`:

- **One Tap**: the login page loads the Google Identity script, posts the
  credential to `/api/auth/one-tap/callback` and follows the two-factor redirect.
- **OAuth callback**: **Continue with Google** goes through the authorization
  endpoint once, and `/api/auth/callback/google` answers 302.

For both it asserts that no session cookie exists and `/api/me` answers 401 before
the code while a challenge cookie does, that the challenge opens on the request
origin and keeps `returnTo`, and that after the TOTP code the browser lands on
`/account?tab=security` signed in as that user.

Google itself is faked, only inside the suite: `scripts/google-fake.ts` answers
Google hosts in the browser (Playwright routes for the Identity script and the
authorization endpoint) and on the server (`scripts/google-fake-server.ts` wraps
the server entry and replaces `fetch` for Google's token and certificate
endpoints). The ID token is signed with a key generated per run, and the real
Better Auth code verifies it; any other request to a Google host fails the suite.
Placeholder `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` values turn the provider on.

What it does not prove:

- **The real Google consent screen and token exchange.** Those still need the
  manual smoke below.
- **That One Tap loads in production.** The login document's content security
  policy allows scripts from the platform only (`script-src 'self'` in the static
  hosting headers of `vercel.json`; `'self'` plus a per-response nonce from the
  server middleware in `apps/server/src/app.ts`). It blocks
  `https://accounts.google.com/gsi/client`, so the One Tap prompt never runs in a
  real browser today. The One Tap scenario creates its browser context
  with the policy bypassed, which keeps the page branch and the server path
  covered; the OAuth scenario and the other journeys run under the real policy.
  Allowing Google's script on the login document needs a dated owner decision in
  `app/CLAUDE.md`, like the checkout-analytics and parcel-locker decisions there.
- **Google on a host resolved through `tenant_domains`.** The public auth
  configuration hides Google on any host that resolves through a `tenant_domains`
  row, and the seed stores such a row (`acme.localhost`, kind `subdomain`). The
  suite deletes that row from its own database so acme resolves through the
  subdomain alone, as a workspace created in the product does.

## What is wired

- `apps/server/src/composition.ts` reads `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`. The Google provider is configured **only when both are
  present**; otherwise it is never registered.
- `GET /api/public/auth-config` returns `{ googleEnabled, passkeysEnabled: true,
  totpEnabled: true }`. The login page renders **Continue with Google** only when
  `googleEnabled` is `true`, so the button is absent in a default checkout.
- Sign-in goes through `AuthClientPort.signInWithGoogle()`, which the web adapter
  implements via the Better Auth social client (`signIn.social({ provider: 'google' })`).

## Configure the credentials

1. In Google Cloud Console create an OAuth 2.0 Client ID (type: Web application).
2. Add the authorized redirect URI for your dev origin:
   `http://localhost:48730/api/auth/callback/google`
   (and the equivalent for any tenant subdomain you test, e.g.
   `http://acme.localhost:48730/api/auth/callback/google`).
3. Put the pair in your local `.env` (never commit real values):

   ```
   GOOGLE_CLIENT_ID=<your client id>
   GOOGLE_CLIENT_SECRET=<your client secret>
   ```

## Manual smoke steps

```bash
pnpm run db:up && pnpm run db:migrate && pnpm run db:seed
pnpm run dev:server      # port 48730
pnpm run dev:web         # port 48731
```

1. Open `http://acme.localhost:48731/login`.
2. Confirm **Continue with Google** is now visible (it is hidden without the env pair).
3. Click it, complete Google consent, and confirm you land in the authenticated
   workspace.
4. Sanity-check the gate the other way: unset the env pair, restart the server, and
   confirm `curl http://localhost:48730/api/public/auth-config` reports
   `"googleEnabled":false` and the button disappears.

## No secrets are committed

`.env.example` ships both keys **empty** with a one-line note. Real client IDs and
secrets live only in your untracked local `.env`. Nothing in the repository contains
Google credentials. The automated gates run with the provider disabled, except the
two-factor suite, which enables it with placeholder values against the fake.
