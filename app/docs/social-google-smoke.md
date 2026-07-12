# Google social sign-in — manual smoke

Google is the one auth method the PoC cannot exercise headlessly: it needs a real
OAuth consent screen. It is therefore **env-gated** and verified by hand. Passkeys
and TOTP 2FA are covered automatically by `npm run e2e:auth`.

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
npm run db:up && npm run db:migrate && npm run db:seed
npm run dev:server      # port 48730
npm run dev:web         # port 48731
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
Google credentials, and the automated gates run with the provider disabled.
