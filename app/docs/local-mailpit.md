# Local Mailpit

The database-backed sink is the default with `EMAIL_PROVIDER=dev`. Mailpit is
an optional local SMTP target for authentication and transactional messages.
It captures mail without external delivery, exposes SMTP on port `48925`, and
provides its inbox and HTTP API at `http://localhost:48980`.

Set these values in the local `app/.env`:

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM=Together <dev@together.local>
SMTP_HOST=localhost
SMTP_PORT=48925
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
```

From `app/`, start the services and server:

```bash
docker compose -f docker-compose.dev.yml --profile mailpit up -d
pnpm run dev:server
```

Magic links and other platform transactional messages pass through the outbox
and SMTP adapter before appearing in Mailpit. Open the inbox to follow a
captured link. Local SMTP credentials are optional; an authenticated relay
requires a complete user/password pair.

Local marketing delivery stays on the database-backed development path even
when Mailpit is selected. Production platform delivery uses its configured
provider, and tenant marketing uses the tenant transport policy.
