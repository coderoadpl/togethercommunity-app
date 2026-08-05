# Self-host Together

Prerequisites: Git, Docker Engine with Compose v2, and a machine with at least
2 GB RAM. Clone the repository, enter `app/`, and create the only configuration
file the stack reads:

```bash
git clone https://github.com/coderoadpl/togethercommunity-app.git together
cd together/app
cp .env.self-host.example .env
```

Fill every empty value in `.env`. Generate URL-safe secrets with
`openssl rand -hex 32`; use `openssl rand -base64 32` for
`SECRETS_MASTER_KEY`. `POSTGRES_PASSWORD` must remain URL-safe. Keep
`APP_BASE_DOMAIN` empty for single-tenant mode. The included Caddy proxy
overwrites `X-Forwarded-For`, matching the template's sanctioned
`AUTH_TRUSTED_PROXY_HEADER=x-forwarded-for`. Then start Postgres, Together, and
Caddy:

```bash
docker compose up -d --build
```

Open <http://localhost/register>, create the owner account, name the first
workspace, and the setup checklist appears in the authenticated panel. In
production, `TENANT_CREATION=open` is a bootstrap mode: the server atomically
allows the first workspace and rejects every later attempt. Set it to `closed`
after setup to make the intended steady-state configuration explicit.

The example uses Stripe and SMTP so a production installation never silently
accepts free fake purchases or discards outgoing mail. Set `EMAIL_FROM` and the
SMTP connection fields before boot. After creating the workspace, add its
Stripe credentials in the integration settings before publishing paid offers.
Use `PAYMENT_PROVIDER=fake` or `EMAIL_PROVIDER=dev` only for a disposable test
installation; fake payments complete without charging and the development
mail sink sends nothing externally.

For a public domain, set `APP_BASE_URL=https://community.example.com`,
`SECURE_COOKIES=true`, and keep ports 80/443 reachable. Point DNS at this host.
Caddy obtains certificates on demand only after the hostname is a verified
tenant domain, matches the host in `APP_BASE_URL`, or is a one-level subdomain
of `APP_BASE_DOMAIN`; its approval endpoint is available solely inside the
Compose network. Set `APP_BASE_DOMAIN` only when running subdomain-based
multi-tenancy. TLS for unrelated custom tenant domains remains unavailable
until the domain-management package provides a verification flow.

Persistent data lives in the `postgres_data`, `caddy_data`, and `caddy_config`
volumes. Back up PostgreSQL before upgrades. To upgrade, check out the intended
release and run `docker compose up -d --build` again. Inspect health and logs
with `docker compose ps` and `docker compose logs -f app`.

## Clone-to-panel budget

`pnpm run quickstart:probe` performs a clean local Git clone, builds the real
production image, runs `docker compose up`, registers an owner, creates the
single workspace, and waits for the setup checklist in Chrome. It also verifies
that running the seed twice leaves every table's row count unchanged. The probe
fails when clone-to-authenticated-panel takes 900 seconds or more, and the CI
smoke job executes that same automated path on every pull request. The first
workspace can be created before the registered address is verified; verification
is required for any later workspace creation where instance policy permits it.
