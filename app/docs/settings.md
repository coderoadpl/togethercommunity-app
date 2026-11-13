# Tenant settings

Video autoplay is controlled by the creator in **Studio → Settings → Company → Video playback**. The tenant default applies when member overrides are disabled or a member has not chosen a preference; when overrides are enabled, members can choose autoplay from their account page. The CLI exposes the same policy through `tenant settings` and `tenant settings-set --video-autoplay-default <true|false> --member-video-autoplay-override <true|false>`.

Creators can publish a plain-text notice through **Studio → Settings → Company → Sign-in**.
The notice is disabled by default, preserves line breaks and accepts up to 600
characters. When enabled and nonempty, it appears above the public sign-in form.
The existing public offer payload includes `tenant.signInNotice`; it contains
public copy and must never hold private account or member information. Saving
uses the tenant settings mutation and refreshes the public offer cache.

Owners manage administrators in **Studio → Settings → Security → Team**. Adding an
e-mail address creates a pending invitation and sends a sign-in link. Every valid
address receives the same opaque confirmation, regardless of whether an account
already exists or has a verified address. Pending invitations appear as
**Invitation sent**, with a **Revoke invitation** action. Any successful
mailbox-proving magic-link sign-in on the tenant host activates the administrator
role automatically, after any required two-factor authentication; the link need
not come from the invitation e-mail, and no owner retry is needed. Password
sign-in and ordinary e-mail verification do not activate pending invitations.

If a successful magic-link sign-in verifies a previously unverified account,
verification removes its password credentials, passkeys, two-factor enrollment
and pending user-bound verification values, including two-factor challenges,
revokes all existing sessions and resets two-factor status in the same locked
transaction, before any invitation is activated. This invalidates authenticators
and challenges created before mailbox ownership was proved. Already verified
accounts are unchanged. The person can continue using sign-in links, set a
password through the e-mailed reset flow and enroll new authenticators.

Administrators can use Studio except platform settings, secrets, API keys and the
integration test. Adding an existing team member is idempotent and never
downgrades an owner. Owners cannot remove themselves or another owner; removing
an administrator or revoking an invitation requires confirmation. Invitation,
activation and revocation events are recorded in the tenant audit history.

The owner-only CLI commands are `team list`, `team add <email>` and
`team remove <email>`. Team changes are recorded in the tenant audit history.

## Meta server-side conversions

The owner configures Meta CAPI beside the checkout analytics pixel settings.
`analyticsMetaCapiEnabled` defaults to false. A configured pixel and privacy URL
are required before a buyer can grant consent. The optional test event code and
plain-text consent heading, body and button labels are ordinary tenant settings;
the `analyticsMetaCapiAccessToken` is stored separately through the encrypted,
owner-only tenant-secret API and is never returned, even partially.

The CLI supports `tenant settings-set --analytics-meta-capi-enabled <true|false>`,
`--analytics-meta-capi-test-event-code <code>`, and the
`--analytics-meta-capi-consent-{heading,body,accept-label,decline-label}` flags.
An empty string clears the test code or restores a default copy field.
`tenant-secret set analyticsMetaCapiAccessToken <value>` sets the token;
`tenant-secret delete analyticsMetaCapiAccessToken` clears it.
`meta-capi events` lists the selected workspace's latest delivery evidence.
See [Meta CAPI](integrations/meta-capi.md) for payload, consent, withdrawal,
privacy obligations, retry behavior and verification.
