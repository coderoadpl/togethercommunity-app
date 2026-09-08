# Terminology glossary

Use one canonical term per concept on every user-facing surface. The
[English dictionary](../apps/web/src/i18n/en.ts) and
[Polish dictionary](../apps/web/src/i18n/pl.ts) hold localized wording, including
error messages. Transactional email copy follows the same terminology.
Write in a competent, warm, direct voice.

## People and roles

| Concept | English term | Usage |
|---|---|---|
| Person with access | member | Use across courses, community, the panel, and email; avoid course-only labels. |
| Person running a workspace | creator | A persona, never a permission label. |
| Workspace owner role | owner | Use in role labels and permission descriptions. |
| Administrator role | admin | A permission level, not a synonym for creator. |
| Owner and admins collectively | staff | Use for shared permissions and moderation messages. |
| Visitor before purchase | No noun needed | Describe the action, such as sharing a checkout link; after purchase, use member. |

## Commerce

| Concept | English term | Usage |
|---|---|---|
| Sellable unit | product | A product grants access to content; products and courses are distinct. |
| Price | price | One-time or recurring; recurring prices have a billing interval. |
| Recurring purchase | subscription | Statuses: active, payment past due, canceled. |
| Sales ledger entry | order | Statuses: paid, pending, failed, refunded; lowercase in tables. |
| Access entitlement | grant | Both noun and verb; states include active, expired, and perpetual. |
| Withdraw an entitlement | revoke | Keep distinct from claiming free access. |
| Free checkout action | get it for free | Checkout call to action. |
| Purchase surface | checkout | Distinguish the whole surface from the payment step. |
| Shareable purchase URL | checkout link | Use consistently instead of purchase link. |
| Provider billing UI | billing portal | Member heading: Payments; action: Manage payments. |
| Payment integration | payment provider | Use the same term in orders, subscriptions, and integrations. |
| Free sample content | free preview lesson | Use consistently across sample content. |

## Content structure

| Concept | English term | Usage |
|---|---|---|
| Course content | course | Distinct from the product selling access. |
| Reusable content group | module | Can be attached to multiple courses. |
| Group inside a module | chapter | Contains lessons. |
| Learning unit | lesson | Contains content blocks. |
| Lesson building block | content block | Short form: block. |
| Course outline | course curriculum | Eyebrow: course syllabus. |
| Connect or disconnect a module | attach / detach | Use the same pair throughout. |
| Publication state | draft / published | Use consistently for state labels. |
| Member's owned content | library | Use in access and missing-course messages. |

## Community

| Concept | English term | Usage |
|---|---|---|
| Lesson conversation | discussion | A discussion contains threads. |
| Root post and replies | thread | Actions: follow thread, mute. |
| Message inside a thread | post | Verb: Post; response: reply, Reply. |
| Community feed area | space | A space is inside a workspace; never use space for the tenant. |
| Emoji response | reaction | Closed set: thumbs up, heart, celebration, light bulb, laughing. |
| Subscribe to a feed | follow space | Opposite: unfollow. |
| Staff moderation restriction | ban | Keep distinct from member-to-member blocking. |
| Private contact restriction | block / unblock | A symmetric cut-off; copy must not disclose who blocked whom. |
| Report private contact | report conversation | Staff surface: Reported direct conversations; action: Close report. |
| Member messaging surface | messages | One item: message; the two-person exchange: conversation. Avoid direct messages in member-facing copy. |

## Workspace and account

| Concept | English term | Usage |
|---|---|---|
| Tenant | workspace | Never expose tenant in user-facing copy. The Polish workspace term is distinct from the community-space term. |
| Login identity | account | Shared authentication identity. |
| Passwordless login URL | magic link | Use the canonical localized word order. |
| Passwordless credential | passkey | Keep distinct from an API key. |
| Additional sign-in factor | two-factor authentication | Spell it out in action labels. |
| S3-compatible service | file storage | Its container is a bucket in both languages. |
| Short-lived migration credential | import key | Avoid migration API key. |
| Setup status | Configured / Not configured | One adjectival pair throughout setup checklists. |
| Staff preview of member UI | member view | Name whose view it is, without impersonation jargon. |
| Invoice provider | iFirma | Preserve trademark casing. |

## Actions and tone

Use Save, Create, Add, Revoke, Renew, Publish, and Manage consistently. Use
Delete when destroying content and Remove when taking an item out of a
collection. The established Remove member label is an exception; its dialog
must explain the data impact. Use Close after an action has succeeded, and
Cancel while the user can still abandon it. Irreversibility copy is
“This cannot be undone.” Upload progress uses “Uploading…”; localized action
and progress wording comes from the dictionaries.

Errors explain what happened and what the user can do next, without blame or
raw backend messages. Expose diagnostic identifiers as Trace ID. Keep headings
short and put details in the body. Member-safe errors are the default; creator
integration hints belong only in the panel.

Polish copy addresses the user directly, with grammatically required capitalized
second-person forms. Avoid gendered past-tense statements addressed to the user;
use present tense, imperatives, or noun phrases. Third-person gender alternatives
are permitted. English uses plain “you.”

## Formatting and localization

- Buttons, table headings, and section headings use sentence case. Field labels
  are lowercase except for proper names.
- Use language-appropriate typographic quotes, spaced dashes for asides, and a
  single ellipsis character for progress states.
- Format numbers and currency through `Intl` with `pl-PL` or `en-GB`; dates use
  `dateStyle: 'medium'`. The shared formatter is
  [`apps/web/src/lib/format.ts`](../apps/web/src/lib/format.ts).
- Polish email terminology uses a hyphen; English uses email. Polish plurals
  use the three-form helper, including agreeing adjectives.
- Duration abbreviations and all localized examples belong in the dictionaries.
  Avoid English technical nouns in Polish copy where a canonical translation
  exists; retain established vendor terms such as bucket.
