# Sign in with Together — estimate

Status: estimate only, nothing built. Written alongside the entitlement check
([entitlement-check.md](entitlement-check.md)), which already answers "has this
person paid?" without single sign-on.

## What it would be

Together becomes an OpenID Connect provider. Another application registers as a
client, sends the person to Together to sign in, and receives an ID token naming
the account. It can then call the entitlement check by member id instead of
matching e-mail addresses.

## What it needs

| Part | Content |
| --- | --- |
| Provider | An OpenID Connect provider on top of the authentication library the server already uses, mounted on the platform host only. The installed version (1.7.15) bundles a `jwt` plugin (signing keys and JWKS) but no provider plugin; the provider is published as a separate package that is not installed, so its licence, maturity and version are the first thing to check. Discovery document, JWKS, authorization, token, userinfo and end-session endpoints. Signing keys stored as a platform secret with a rotation path. New tables for clients, tokens and consents (one migration). A deployment switch, off by default. |
| Client registration | Per application, by a verified workspace owner in their own session (CLI first, Studio later), never dynamic registration. Exact redirect URIs, PKCE required, client secret shown once, revocable, bound to one workspace. |
| Claims | `sub` (stable account id, never the e-mail), `email`, `email_verified`, the workspace and the member id. Entitlements stay a separate call; no access list in the token, so a token never goes stale on access. |
| Consent | A consent page for clients the owner has not marked first-party; skipped for the owner's own clients. Consent records kept and withdrawable. |
| Session and logout | Together's session stays the source; the client gets its own session. RP-initiated logout. Back-channel logout later. Ban, erasure, password change and account deletion revoke refresh tokens. |
| Token lifetimes | ID token 10 minutes; access token 15 minutes; refresh token 30 days, rotated on use, reuse revokes the family. |
| Organization level | Organizations (promotion 24) could own one client for several workspaces and put the organization in the token. Not needed for the first step; designing claims so the organization can be added later without changing `sub`. |

## Smallest useful first step

A first-party client only: the owner registers one client for one workspace, no
consent page (first-party), claims `sub`, `email`, `email_verified`, `member_id`.
The other application signs the person in with Together and calls the
entitlement check by member id. No Studio UI, no organization claims, no
back-channel logout.

## Risks

- The session cookie is set for the base domain and covers every workspace
  subdomain, so the authorization endpoint must run on the platform host only and
  must not be reachable on workspace custom domains (the issuer is one host).
- Redirect URI handling is the main attack surface (open redirect, code
  interception): exact match plus PKCE, no wildcards.
- The provider package is a new dependency: its licence must be permissive and
  its maturity checked before building; if it does not fit, the protocol has to be
  written on top of the `jwt` plugin, roughly doubling the provider part.
- The consent page is a new web screen; the visual baseline catalogue is at its
  cap, so it would ship with stories and tests but without goldens until room is
  made.
- Other applications must link accounts by `sub`, never by e-mail, or a changed or
  reused address takes over an account.
- Member erasure has to reach issued tokens and consent records.

## Size

| Pull request | Size |
| --- | --- |
| 1. Provider plugin behind a switch, keys, tables, discovery and JWKS | large |
| 2. Client registration (owner session, CLI, docs) | medium |
| 3. Claims, member binding, first-party clients | medium |
| 4. Logout, revocation on ban, erasure and password change, token lifetimes | medium |
| 5. Consent page for third-party clients | medium |
| 6. Security review fixes and the owner decision record | small |

First step = pull requests 1 to 3 (three pull requests). The full feature is about
six pull requests.
