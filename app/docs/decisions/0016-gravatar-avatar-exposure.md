# ADR-0016: Gravatar-derived avatars and e-mail hash exposure

Status: accepted, 2026-08-17.

## Context

Member identity now carries an avatar. The server resolves one nullable
`avatarUrl` string per identity through a fixed chain: the auth provider's
`user.image` (a Google account photo when the member signed in with Google),
then a Gravatar URL, then a client-side initials fallback when neither image
loads.

The Gravatar URL is `https://www.gravatar.com/avatar/<sha256(normalized
e-mail)>?d=404&s=160`. Normalization is `trim` plus lowercase; hashing runs
through the existing `ContentHash` port, so `core/server` stays free of node
builtins.

That URL embeds a hash of the member's e-mail address. An e-mail hash is a
pseudonymous identifier: it cannot be reversed in general, but anyone who
already knows or guesses an address can confirm membership by hashing it, and
the hash is a stable cross-site identifier for accounts that use Gravatar
elsewhere.

## Decision

Accept the industry-standard exposure without an opt-in gate, with a hard
boundary at the anonymous layer.

Reasons:

- The audience is the authenticated members and staff of one tenant community.
  They already see the author's display name and can reply to them. The
  marginal information a hash adds to an already-attributed post is small.
- Gravatar-hash-in-page is the standard mechanism of the WordPress, Discourse
  and Gravatar ecosystem. Using sha256, the current Gravatar spec, also avoids
  the md5 rainbow-table ecosystem that surrounds the legacy scheme.
- The alternative — a server-side avatar proxy behind an authenticated image
  route — costs egress, latency and caching for a benefit that is small at this
  stage. It stays available later without any contract change, because clients
  treat `avatarUrl` as an opaque string.

## Consequences

Binding mitigations:

1. The anonymous public layer never receives avatar URLs. Public space feed and
   public thread responses leave the author avatar field `null`.
2. The hash is only ever computed server-side. Raw member e-mails are never
   sent to other members; the public post shape carries no e-mail.
3. The URL pins `d=404`, so a missing Gravatar fails the image load and the
   client renders initials instead of a Gravatar-generated identicon that would
   advertise the hash visually. Size is pinned to 160 px and the image element
   sends `referrerPolicy="no-referrer"`.
4. Erased members carry `deleted-<id>@anonymized.invalid` tombstone e-mails, so
   their hashes are meaningless and their Gravatar lookups always 404.
5. Seeded and visual-test environments use addresses with no Gravatar, so the
   rendered result is deterministic initials with no outbound image fetch.
6. `user.image` is provider-populated only: Better Auth rejects an
   `/update-user` or `/sign-up/email` request carrying `image`, so a member
   cannot point their avatar at an arbitrary URL.

Out of scope, noted for the roadmap: a per-member "hide my avatar" toggle on
the existing `member:profile:self-write` route, the avatar proxy above, and
custom avatar uploads, which would supersede Gravatar entirely.
