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
**Invitation sent**, with a **Revoke invitation** action. Completing sign-in through
the workspace's e-mail activates the administrator role automatically; no owner
retry is needed. Unverified accounts never receive administrator access before
proving control of the mailbox.

Administrators can use Studio except platform settings, secrets, API keys and the
integration test. Adding an existing team member is idempotent and never
downgrades an owner. Owners cannot remove themselves or another owner; removing
an administrator or revoking an invitation requires confirmation. Invitation,
activation and revocation events are recorded in the tenant audit history.

The owner-only CLI commands are `team list`, `team add <email>` and
`team remove <email>`. Team changes are recorded in the tenant audit history.
