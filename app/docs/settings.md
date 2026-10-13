# Tenant settings

Video autoplay is controlled by the creator in **Studio → Settings → Company → Video playback**. The tenant default applies when member overrides are disabled or a member has not chosen a preference; when overrides are enabled, members can choose autoplay from their account page. The CLI exposes the same policy through `tenant settings` and `tenant settings-set --video-autoplay-default <true|false> --member-video-autoplay-override <true|false>`.

Creators can publish a plain-text notice through **Studio → Settings → Company → Sign-in**.
The notice is disabled by default, preserves line breaks and accepts up to 600
characters. When enabled and nonempty, it appears above the public sign-in form.
The existing public offer payload includes `tenant.signInNotice`; it contains
public copy and must never hold private account or member information. Saving
uses the tenant settings mutation and refreshes the public offer cache.

Owners manage administrators in **Studio → Settings → Security → Team**. Adding an
e-mail address creates an account when needed and sends a sign-in link. The
administrator role is granted only after the address has been verified. For an
unverified address, the owner is asked to add it again after the recipient signs
in through the link; no administrator access is granted before that retry.
Administrators can use Studio except platform
settings, secrets, API keys and the integration test. Adding an existing team
member is idempotent, never downgrades an owner and does not resend the e-mail.
Owners cannot remove themselves
or another owner; removing an administrator requires confirmation.

The owner-only CLI commands are `team list`, `team add <email>` and
`team remove <email>`. Team changes are recorded in the tenant audit history.
