# ADR-0012: Bring-your-own auth per tenant

Status: proposed, 2026-08-03.

## Context

One Better Auth instance (`adapters/auth/create-auth.ts`) owns every identity
in Together: password, magic link, passkey, TOTP, and Google. `AuthClientPort`
(`core/client/auth-port.ts`) is the only client-side seam and `AuthPort`
(`core/server/ports.ts`) the only server-side one. Users are platform-global;
`members` binds `(tenantId, userId)` and carries grants, marketing consent, and
erasure state; staff comes from `tenant_admins` and reaches the core as
`Identity.staffRole`.

Sessions live in per-domain cookie worlds. A custom domain is its own world,
but on a real base domain `crossSubDomainCookies` issues the session for
`.<baseDomain>`, so one cookie is presented on every tenant subdomain
([security](../security.md)). A session is therefore a platform-wide
credential whose tenant scope is decided by membership lookup, not by the
cookie. Anything that can mint a session can act as that user everywhere.

Tenants with a corporate IdP (Clerk, Auth0, Keycloak) want their members to log
in through it. Together already has the shape for a tenant-supplied provider:
BYO SES keeps non-secret configuration in a settings table gated by
`identityVerifiedAt`, credentials in `tenant_secrets`, and a resolver that
returns `null` until the tenant's identity is verified
(`adapters/email/transactional-resolvers.ts`).

[ADR-0008](0008-tenant-creation-policy.md) deferred the platform staff
principal. This ADR does not revive it: it keeps staff on platform auth so no
new principal is invented.

## Decision

**BYO is identity verification only.** A tenant IdP answers exactly one
question: which verified e-mail address is at the keyboard. Together mints the
session, in its own cookie world, with its own Better Auth session record.
Membership, staff role, product grants, suppression, ban state, and erasure
stay local and unchanged. No group or role synchronisation, and no
just-in-time membership: signing in without a membership lands on the same
"no access" surface it does today.

**Platform accounts always use platform auth.** Owners and admins
(`tenant_admins`) never authenticate through a tenant IdP. Two controls, not
one: a tenant-IdP sign-in that maps to a user holding any `staffRole` is
refused with a pointer to the platform login, and the session carries an
`authOrigin` additional field (`platform` or `tenant-sso:<tenantId>`) that
`getAuthenticatedUser` uses to resolve `staffRole` as `null` for any
tenant-sso session. The second control holds even if the first is bypassed.

**Domain proof gates every assertion.** `tenant_sso_domains` records a claimed
mail domain with a DNS TXT proof and `verifiedAt`, unique across the platform,
mirroring the SES identity gate. Assertions are accepted only for addresses
inside that tenant's verified domains and only with a true `email_verified`
claim. The rationale is the security budget: a tenant that controls
`acme.com`'s DNS and mail can already complete a magic-link sign-in for any
`@acme.com` address, so BYO inside verified domains grants no new power.
Outside them it would let a tenant assert arbitrary platform identities and
receive a cookie valid across every tenant subdomain.

**Enforcement is per verified domain, not per tenant.** This resolves the
mixed-mode question. Each verified domain carries `enforcement: 'optional' |
'required'`, defaulting to `required` when the domain is enabled, and that is
the recommendation. Two reasons:

- Platform credential endpoints are tenant-less. `/sign-in/email`,
  `/sign-in/magic-link`, and `/request-password-reset` receive an address, not
  a tenant. A per-domain rule is decidable from the address alone; a
  per-tenant rule is not.
- A tenant-wide mixed mode leaves a second credential path to the same
  account. Deprovisioning a leaver in the IdP then revokes nothing, because
  the leaver's password, magic link, and passkey still work. The weaker path
  defines the security of the account, which is the opposite of what buying
  SSO is meant to achieve.

Tenant-level mixing survives where it is actually wanted: addresses outside the
verified domains — consumer members who bought a product with a personal
mailbox — keep platform auth untouched. Break-glass for a broken IdP is an
owner action that returns a domain to `optional`, recorded as a tenant event;
enforcement never applies to staff, who are already excluded.

**Wiring goes through Better Auth's generic OAuth/OIDC plugin behind
`AuthClientPort`.** Provider id is `sso:<tenantId>`. Non-secret configuration
(discovery URL, scopes, claim names, canonical host, enforcement) lives in
`tenant_sso_settings`; `sso.clientId` and `sso.clientSecret` join
`tenantSecretKeySchema` and are read through the existing
`TenantSecretResolver`. Discovery and PKCE are required. `redirectURI` is
pinned to the tenant's canonical host so the code exchange finishes in the same
cookie world that will hold the session; a tenant with both a subdomain and a
custom domain picks one canonical host and SSO always starts and ends there.

The plugin takes a static `config` array, but its routes resolve the provider
per request (`options.config.find(...)`), so the array is a registry object
Together owns and refreshes from the database on a short TTL. Tenants change
their IdP configuration without a redeploy. This relies on a request-time
lookup that is not part of the plugin's documented contract, so implementation
must pin it with an adapter test.

**Client and discovery seams.** `AuthClientPort` gains
`signInWithTenantSso({ providerId, callbackURL })`; the CLI adapter returns the
existing not-supported error, as it does for Google. Login becomes e-mail
first: `/api/public/auth-config` stops being a pure server-config echo and
becomes tenant-resolved, returning `tenantSso: { providerId, label,
enforcement } | null` alongside today's capability flags, keeping `Vary: Host,
X-Tenant` and `no-store`. Credential paths refuse addresses in an enforced
domain through the same Better Auth `before` middleware seam that already
carries sign-up consent, and return an error the web client renders as a
redirect to the tenant's IdP.

**Enrollment stays local.** Checkout still calls `ensureUser` to create the
passwordless platform user that grants hang from. For an address in an enforced
domain, `createEnrollmentMagicLink` is skipped and the welcome e-mail links to
the tenant's SSO entry point instead.

**Subject binding and erasure.** `tenant_sso_identities` stores
`(tenantId, subject, userId, linkedEmail)`. The verified e-mail is the mapping
input at first link only; afterwards the IdP subject is authoritative. A
changed e-mail updates the stored address but never moves the binding to a
different user, and a subject that resolves to a user other than the bound one
is refused rather than relinked. Member erasure deletes the binding, and
tenant-IdP sign-in consults the same `erased_member_imports` e-mail HMAC guard
as member import, so a returning IdP identity cannot resurrect a tombstoned
member ([member erasure](../member-erasure.md)).

**Session lifetime carries the deprovisioning gap.** With no back-channel
logout, an IdP deprovisioning takes effect only when Together next asks the
IdP. Tenant-sso sessions therefore carry their mint time next to `authOrigin`,
and identity resolution caps their age below the platform session lifetime, so
the gap is bounded and stated rather than implicit.

## Consequences

BYO tenants must prove a mail domain by DNS before their IdP does anything,
which makes onboarding slower than pasting a client secret and mirrors the SES
onboarding tenants already go through. Tenants whose members use personal
mailboxes get SSO for their staff-adjacent domain and nothing changes for the
rest.

Owners and admins keep a platform password or passkey even at a tenant that
enforces SSO everywhere else. This is deliberate: it keeps the platform's
administrative surface out of tenant-controlled hands and leaves a working
login when a tenant IdP is misconfigured.

The public auth-config route becomes host-dependent, so any future caching of
it must respect the tenant dimension.

Nothing here changes the cookie-world model; it constrains who is allowed to
mint into it. A later move to per-tenant cookie isolation would relax the
domain-proof gate rather than invalidate it.

## Deferred

No implementation lands with this ADR; it records the design so the seams can
be reviewed before code exists.

- SAML, SCIM, back-channel logout, group-to-role synchronisation, and JIT
  membership provisioning.
- More than one IdP per tenant, and more than one tenant per verified mail
  domain. A domain has exactly one owning tenant; overlapping claims are a
  support decision, not a runtime one.
- CLI sign-in through a tenant IdP, which needs the device authorization flow.
- Per-tenant cookie isolation on the shared base domain.
