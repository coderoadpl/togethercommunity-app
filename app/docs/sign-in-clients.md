# Sign-in clients

A sign-in client is a dormant registration for an external application. It
belongs to one workspace. New clients are `pending_activation`; no operation
can activate them. The registry issues no tokens and exposes no sign-in,
discovery, consent, or signing endpoints. It does not check control of a
return host. There is no operator management route or web screen.

## Register and list

All four operations require a verified owner acting in their own session with
a direct grant on the workspace. An organization-derived owner, machine key,
or impersonated session cannot manage or list clients.

The deployment must allow the exact `workspace-id=host` pair in
[`SIGN_IN_CLIENT_HOSTS`](deployment-environments.md#runtime-and-build-configuration).
An unset or empty list refuses creation and rotation, but never prevents an
otherwise authorized owner from listing or disabling a client. Removing a
pair stops credential rotation for that client; it does not change its state.

Register 1–5 distinct absolute HTTPS return addresses on the same host.
Use a lowercase ASCII DNS host, the implicit HTTPS port, and an explicit
path. IP addresses, IDNs, trailing dots, user info, fragments, queries,
wildcards, whitespace, backslashes, and addresses the URL parser would rewrite
are not accepted. Neither the platform base domain nor its subdomains nor a
verified custom workspace domain can be registered. There is no edit or
transfer and the host cannot be assigned again, even after workspace deletion.
Registration does not change how existing custom domains are verified.

The list returns metadata with a 50-item default and 100-item maximum page
size, ordered by creation time then ID. Use the returned cursor to continue.
The list never returns a secret or its digest.

## Rotate or retire

Creation and rotation return the new secret once and mark the response
`Cache-Control: no-store`. Store the secret outside the CLI session profile.
If the answer is lost, list the current credential version and rotate; the
old value cannot be retrieved. Rotation requires the expected version and
replaces the stored digest and expiry atomically, without overlap. The record
stores an expiry 90 days after issuance; there is no issuer to enforce it here.

Disable is terminal. It clears the name, return addresses, digest, and expiry
and increments the credential version. Repeating disable returns the same
retired metadata. There is no purge or host reuse. Each successful state
change records its kind, credential version, time, and actor kind; it does
not identify which direct owner acted. Workspace deletion removes the client
and its events but not the reservation (host, opaque client ID, timestamp).

See the [CLI commands](cli.md#sign-in-clients) and the
[credential boundary](security.md#sign-in-client-secrets).
