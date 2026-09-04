# Custom domains

A workspace is always reachable at `<slug>.<APP_BASE_DOMAIN>`. A creator can
additionally connect up to three of their own domains from
**Panel → Ustawienia → Adresy**. Only the workspace owner sees the controls;
administrators can read the section but cannot change it.

## How it works

1. The owner types a domain and presses **Dodaj domenę**. The platform
   normalises it (lowercase, no scheme, no port, no trailing dot), refuses
   addresses under the platform's own base domain, refuses international
   domains that are not in punycode (`xn--…`) form, and refuses a domain that
   any workspace already holds.
2. The platform asks its domain provider to attach the host and stores the row
   as *pending* together with the DNS records the provider asks for. A new row
   is never stored as verified, even when the provider already holds the name:
   only a check that also sees DNS pointing at the deployment flips it.
3. The Studio shows the exact records. There is always a `CNAME` for routing,
   and — when the provider needs proof of ownership, typically because the
   domain is already registered with another account there — an extra `TXT`
   record on `_vercel.<domain>`.
4. Once the records are published, **Sprawdź teraz** re-reads the provider
   state immediately. A scheduled job repeats the same check every 15 minutes
   for every pending domain, so a domain also goes live on its own.
5. When the domain resolves, the row flips to *Działa*, and the owner gets an
   in-app notification. If a domain is still unresolved 24 hours after it was
   added, the owner gets a single warning notification.
6. **Usuń** detaches the domain at the provider and deletes the row. If the
   request came from the domain being removed, the response carries the
   platform URL to continue on.

The Studio always shows the routing record as a `CNAME`, which DNS forbids at a
zone apex. A bare `example.com` therefore needs either the `ALIAS`/`ANAME`
flattening its registrar offers, pointed at the same value, or an `A` record with
the address the platform operator provides. A subdomain such as
`kurs.example.com` takes the `CNAME` as shown.

## Status chips

| Chip | Meaning |
|---|---|
| Czeka na DNS | The records are published in the Studio; DNS does not point at the deployment yet. |
| Weryfikacja u dostawcy | The provider returned an ownership record that must be published before it will serve the domain. |
| Działa | The domain resolves and serves the workspace. |
| Błąd | The last check failed; the provider message is shown under the domain. |

## What changes for members

A custom domain is a separate credential world:

- members are signed out once and sign in again on the new address;
- passkeys are bound to a host, so they must be registered again there;
- **Google sign-in is unavailable on a custom domain** — the OAuth callback is
  registered for a single origin. Members who signed up with Google use a magic
  link with the same e-mail address, or set a password.

Passwords, magic links and TOTP secrets are unaffected. The workspace
subdomain keeps working, so the switch can be gradual.

## Limits

- three custom domains per workspace;
- ten add attempts and sixty checks per workspace per hour;
- domains must be at least two labels (`courses.example.com`), 253 characters
  or fewer, with no label longer than 63 characters;
- IP addresses and names ending in an all-numeric label are refused;
- a pending domain holds the name against every other workspace until it is
  removed, so a workspace that adds a domain it does not own blocks the real
  owner. There is no automatic expiry yet; the platform operator deletes the
  stale row (`DELETE FROM tenant_domains WHERE domain = '…' AND verified = false`)
  after checking who controls the name.

Every add, verification and removal is appended to `tenant_domain_events`,
which is never updated or deleted. The table is evidence for the platform
operator and has no in-app reader; it is queried directly:

```sql
SELECT at, kind, domain, actor_user_id, detail FROM tenant_domain_events
WHERE tenant_id = '…' ORDER BY at DESC LIMIT 50;
```

## Platform operator setup

Set these on the deployment that terminates TLS:

| Key | Purpose |
|---|---|
| `APP_CUSTOM_DOMAIN_TARGET` | The `CNAME` value shown to creators. Defaults to the platform host. |
| `DOMAIN_PROVISIONER_TOKEN` | Enables provider mode. See the warning below. |
| `DOMAIN_PROVISIONER_PROJECT_ID` | The project the domains attach to. Required together with the token. |
| `DOMAIN_PROVISIONER_TEAM_ID` | Set when the project lives in a team. |
| `DOMAIN_PROVISIONER_GIT_BRANCH` | Routes attached domains at a branch deployment. Set to `staging` on the staging environment; leave unset in production so domains serve the production deployment. |

These keys deliberately avoid the `VERCEL_` prefix: the platform injects its own
`VERCEL_*` system variables (including a project id) into every deployment, and
a name collision there would read as half-configured provisioning.

The scheduled check runs at `/api/internal/domain-check` every 15 minutes and
authenticates with `CRON_SECRET`.

A Vercel token carries every permission its owner has across the whole team —
it cannot be limited to one project or to domain operations. Anyone who reads
`DOMAIN_PROVISIONER_TOKEN` out of the runtime can read environment variables, trigger
deployments and delete projects. Issue it from a dedicated team member with the
narrowest role that can attach domains, never from the team owner's account,
and rotate it whenever anyone with runtime access leaves.

### Manual mode

With no `DOMAIN_PROVISIONER_TOKEN` the platform runs the manual provisioner: adding a
domain records the row and shows the `CNAME` to `APP_CUSTOM_DOMAIN_TARGET`, and
nothing else contacts an external API. The domain stays *Czeka na DNS* until an
operator flips it:

```sql
UPDATE tenant_domains SET verified = true, verified_at = now()
WHERE domain = 'kurs.example.com';
```

The scheduled check does nothing in this mode: no provider can report DNS, so a
pass could only mistake a missing operator flip for a misconfigured domain and
alert the workspace about correct records. It also never demotes a verified row,
so an operator decision survives every later pass. This is the mode self-hosted installs behind their
own proxy run on permanently; the bundled Caddy configuration asks
`/internal/domain-check` whether a host is allowed before issuing a
certificate.
