# Terminology glossary

Use one canonical term per concept on every user-facing surface. The
[English dictionary](../apps/web/src/i18n/en.ts) and
[Polish dictionary](../apps/web/src/i18n/pl.ts) hold localized wording, including
error messages. Transactional email copy follows the same terminology.
Write in a competent, warm, direct voice. If a user-facing term is missing here,
add it here before using it in either dictionary.

## People and roles

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Person with access | uczestnik | member | Use across courses, community, the panel, and email; avoid course-only labels. Do not use kursant or członek in user-facing copy. Seed data display names may keep legacy Kursant fixtures. |
| Person running a workspace | twórca | creator | A persona word, never a permission label. |
| Workspace owner role | właściciel | owner | Use in role labels and permission descriptions. |
| Administrator role | administrator | admin | A permission level, not a synonym for creator. |
| Owner and admins collectively | zespół | staff | Use for shared permissions and moderation messages. |
| Visitor before purchase | No noun needed | No noun needed | Describe the action, such as sharing a checkout link; after purchase, use member. Do not use klient or customer. |

## Commerce

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Sellable unit | produkt | product | A product grants access to content; products and courses are distinct. |
| Price | cena | price | One-time or recurring; recurring prices have a billing interval. |
| Recurring purchase | subskrypcja | subscription | Statuses: active, payment past due, canceled. Do not use abonament. |
| Sales ledger entry | zamówienie | order | Statuses: paid, pending, failed, refunded; lowercase in tables. |
| Access entitlement | dostęp | grant | Long form: przyznany dostęp. Verb: przyznać / grant. States include active, expired, and perpetual. |
| Withdraw an entitlement | cofnąć dostęp | revoke | Keep distinct from claiming free access. Do not use odbierz for revocation. |
| Free checkout action | odbierz za darmo | get it for free | Checkout call to action. |
| Purchase surface | płatność | checkout | Distinguish the whole surface from the payment step; do not use checkout as a Polish noun. |
| Shareable purchase URL | link do zakupu | checkout link | Use consistently instead of purchase link or link do płatności. |
| Provider billing UI | portal płatności | billing portal | Member heading: Płatności / Payments; action: Zarządzaj płatnościami / Manage payments. |
| Payment integration | dostawca płatności | payment provider | Use the same term in orders, subscriptions, and integrations. |
| Free sample content | bezpłatna lekcja próbna | free preview lesson | Use consistently across sample content. |

## Content structure

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Course content | kurs | course | Distinct from the product selling access. |
| Reusable content group | moduł | module | Can be attached to multiple courses. |
| Group inside a module | rozdział | chapter | Contains lessons. |
| Learning unit | lekcja | lesson | Contains content blocks. |
| Lesson building block | blok treści | content block | Short form: blok / block. |
| Course outline | program kursu | course curriculum | Eyebrow: course syllabus. |
| Connect or disconnect a module | podepnij / odepnij | attach / detach | Use the same pair throughout. Do not use podłącz / odłącz for this concept. |
| Publication state | wersja robocza / opublikowany | draft / published | Use consistently for state labels. |
| Member's owned content | biblioteka | library | Use in access and missing-course messages. |

## Community

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Lesson conversation | dyskusja | discussion | A discussion contains threads. |
| Root post and replies | wątek | thread | Actions: obserwuj wątek / follow thread; wyciszono / muted. |
| Message inside a thread | wpis | post | Verb: Opublikuj / Post; response: odpowiedź / reply, Odpowiedz / Reply. |
| Community feed area | przestrzeń | space | A space is inside a workspace; never use space for the tenant in English. |
| Emoji response | reakcja | reaction | Closed set: thumbs up, heart, celebration, light bulb, laughing. Verb: zareaguj / react. |
| Subscribe to a feed | obserwuj przestrzeń | follow space | Opposite: przestań obserwować / unfollow. |
| Staff moderation restriction | ban | ban | Keep distinct from member-to-member blocking. |
| Private contact restriction | zablokuj / odblokuj | block / unblock | A symmetric cut-off; copy must not disclose who blocked whom. |
| Report private contact | zgłoś rozmowę | report conversation | Staff surface: Zgłoszone rozmowy prywatne / Reported direct conversations; action: Close report. |
| Member messaging surface | wiadomości | messages | One item: wiadomość / message; the two-person exchange: rozmowa / conversation. Avoid direct messages in member-facing copy. |

## Workspace and account

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Tenant | platforma | workspace | Never expose tenant in user-facing copy. The Polish workspace term is distinct from the community-space term. |
| Login identity | konto | account | Shared authentication identity. |
| Passwordless login URL | magiczny link | magic link | Use the canonical localized word order. |
| Passwordless credential | klucz dostępu | passkey | Keep distinct from an API key. |
| Additional sign-in factor | uwierzytelnianie dwuskładnikowe | two-factor authentication | Spell it out in action labels. |
| S3-compatible service | magazyn plików | file storage | Its container is a bucket in both languages. |
| Short-lived migration credential | klucz importu | import key | Avoid migration API key. |
| Setup status | Skonfigurowane / Nieskonfigurowane | Configured / Not configured | One adjectival pair throughout setup checklists. |
| Staff preview of member UI | podgląd uczestnika | member view | Name whose view it is, without impersonation jargon. |
| Invoice provider | iFirma | iFirma | Preserve trademark casing. |

## Actions and tone

Use the same action vocabulary throughout the product.

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Save | Zapisz | Save | Use for persisting edits. |
| Create | Utwórz | Create | Use for creating a new object. |
| Add | Dodaj | Add | Use for adding an item. |
| Delete | Usuń | Delete | Use when destroying content. |
| Remove | Usuń | Remove | Use when taking an item out of a collection. The established Remove member label is an exception; its dialog must explain the data impact. |
| Revoke | Cofnij dostęp | Revoke | Use only for withdrawing an access grant. |
| Renew | Odnów | Renew | Use for extending access or subscription state. |
| Publish | Opublikuj | Publish | Use for publication state transitions. |
| Manage | Zarządzaj | Manage | Use for management surfaces and external portals. |
| Close | Zamknij | Close | Use after an action has succeeded. |
| Cancel | Anuluj | Cancel | Use while the user can still abandon the flow. |
| Irreversibility notice | Tej operacji nie można cofnąć. | This cannot be undone. | One canonical sentence. |
| Upload progress | Przesyłanie… | Uploading… | Use the single ellipsis character for progress states. |

Errors explain what happened and what the user can do next, without blame or
raw backend messages. Expose diagnostic identifiers as Trace ID / Identyfikator
śledzenia. Keep headings short and put details in the body. Member-safe errors
are the default; creator integration hints belong only in the panel.

Polish copy addresses the user directly, with grammatically required capitalized
second-person forms. Avoid gendered past-tense statements addressed to the user;
use present tense, imperatives, or noun phrases. Third-person gender alternatives
are permitted. English uses plain you.

## Formatting and localization

Apply these mechanics consistently in both dictionaries and transactional email.

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| Button casing | sentence case | sentence case | Buttons, table headings, and section headings use sentence case. |
| Field labels | lowercase except proper names | lowercase except proper names | Preserve proper-name casing such as Stripe, Bunny Stream, and iFirma. |
| Quotes | „lowered-raised” | “curly” | Use language-appropriate typographic quotes. |
| Dashes | spaced dash | spaced dash | Use spaced dashes for asides; do not use a bare hyphen as punctuation. |
| Ellipsis | … | … | Use a single ellipsis character for progress states. |
| Numbers and currency | `Intl` with `pl-PL` | `Intl` with `en-GB` | Dates use `dateStyle: 'medium'`. The shared formatter is [`apps/web/src/lib/format.ts`](../apps/web/src/lib/format.ts). |
| Email term | e-mail | email | Polish email terminology uses a hyphen; English does not. |
| Plurals | three-form helper | count-aware copy | Polish plurals use the three-form helper, including agreeing adjectives. |
| Duration abbreviations | godz. / min | h / min | Duration abbreviations and localized examples belong in the dictionaries. |
| Vendor terms | established proper nouns | established proper nouns | Avoid English technical nouns in Polish copy where a canonical translation exists; retain established vendor terms such as bucket. |

## Forbidden anglicisms (PL)

Never in Polish copy: member, workspace, tenant, checkout (as a noun), billing
(bare), subskrybent, draft, feature, dashboard (use przegląd), progress (use
postęp or postępy), community (use społeczność). Technical proper nouns are fine
(Stripe, webhook, restricted key, PDF, HTML, CSV, JSON); gloss in parentheses
when a Polish label exists, such as klucz ograniczony (restricted key).
