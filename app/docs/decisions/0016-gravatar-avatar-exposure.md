# ADR-0016: External avatar lookup

Status: Superseded on 2026-09-07 by the account-avatar pipeline.

## Decision

The earlier design derived a third-party avatar URL from a member e-mail address.
That lookup is no longer performed. Members now use a host-relative image asset
stored through the tenant image pipeline, an imported Google profile picture, or
the shared initials fallback.

Provider images are fetched, validated, resized, and stored by the server. The
application never exposes the provider URL to clients. Removing an uploaded or
imported picture clears the account image and restores initials.
