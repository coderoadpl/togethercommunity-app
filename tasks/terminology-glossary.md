# Together — terminology glossary

Canonical terminology for every user-facing surface: web dictionaries
(`apps/web/src/i18n/pl.ts`, `en.ts`), error messages (`errors` section and
`errors.ts` mapping), transactional emails (`core/domain/transactional-email.ts`),
and future copy. One concept has one canonical term in each language.
English is the product and repository default. Polish wording lives only in
translation dictionaries; consult the corresponding keys there.
Voice: competent, warm, never corporate. Add new concepts here before using them.

## Personas and roles

| Concept | English | Decision notes |
|---|---|---|
| person with access in a workspace | **member** | Use throughout the panel, member pages, emails, and English seed fixtures. Avoid a course-only student label for this broader concept. |
| person who runs a workspace | **creator** | Persona, as in “creator panel”; never a role label. |
| owner role | **owner** | Role labels in member lists and chips. |
| administrator role | **admin** | Permission level; not a synonym for the creator persona. |
| owners and admins collectively | **staff** | For example, “staff access”. |
| visitor before purchase | *(avoid the noun)* | Say “Share a checkout link…”. Do not call visitors customers; after purchase they are members. |

## Commerce

| Concept | English | Decision notes |
|---|---|---|
| sellable unit | **product** | A product grants access to course content. |
| content unit | **course** | Products and courses differ. Say “buy a course” only when the product is literally one course; otherwise use product or checkout link. |
| price | **price** | One-time or recurring; fields are “price kind” and “billing interval”. |
| subscription | **subscription** | Statuses: active, payment past due, canceled. |
| order | **order** | Statuses: paid, pending, failed, refunded; lowercase in tables. |
| access entitlement | **grant** | Verb: grant. States: active, expired, perpetual. |
| revoke a grant | **revoke** | Keep distinct from the free-claim action in both dictionaries. |
| claim without payment | **get it for free** | Checkout CTA. |
| purchase surface | **checkout** | Creator copy names the surface; the buyer-facing “Payment” eyebrow and loading state name the payment step. |
| purchase URL | **checkout link** | Do not alternate with “purchase link”. |
| billing portal | **billing portal** | Member heading: “Payments”; CTA: “Manage payments”. |
| payment service | **payment provider** | Use consistently in orders, subscriptions, and Integrations; avoid bare “Operator”. |
| free sample lesson | **free preview lesson** | One name throughout the product. |

## Content structure

| Concept | English | Decision notes |
|---|---|---|
| course | **course** | |
| reusable course unit | **module** | Reusable between courses. |
| section inside a module | **chapter** | |
| lesson | **lesson** | |
| lesson content element | **content block**, short **block** | |
| curriculum or syllabus | **course curriculum** | Eyebrow: “course syllabus”. |
| module association | **attach / detach** | Use this pair consistently, including “detached from the course”. |
| publication state | **draft / published** | |
| member's collection | **library** | “This course is not in your library.” |

## Community

| Concept | English | Decision notes |
|---|---|---|
| per-lesson discussion | **discussion** | |
| conversation thread | **thread** | |
| message in a thread | **post** | Verb: Post. Response noun and verb: reply / Reply. |
| thread subscription | **follow thread** | Opposite state: muted. |
| feed area inside a workspace | **space** | Reserve this term for community spaces, not tenants. The current Polish distinction is defined in `pl.ts`; it supersedes the earlier zone proposal. |
| emoji response | **reaction** | Closed set: 👍 ❤️ 🎉 💡 😂. Verb: react. |
| space subscription | **follow space** | Same verb as threads; opposite: unfollow. |
| staff exclusion of a member | **ban** | Keep the colloquial term in confirmation dialogs. Badge: Banned. Do not call this blocking. |
| member-to-member message cutoff | **block / unblock** | Separate from a staff ban. This is a private, symmetric cutoff: copy must not reveal who blocked whom. |
| flag a private conversation | **report conversation** | Staff surface: “Reported direct conversations”; action: “Close report”. Same report verb as posts. |
| member messaging surface | **messages** | Match navigation. Do not expand this to “direct messages” on the member surface. A single item is a message; the pair of people has a conversation. |

## Platform

| Concept | English | Decision notes |
|---|---|---|
| tenant, user-facing | **workspace** | Never expose “tenant”. Keep distinct from community spaces. |
| account | **account** | |
| passwordless sign-in link | **magic link** | The Polish dictionary consistently uses adjective-first word order. |
| passkey | **passkey** | |
| second authentication factor | **two-factor authentication** | One name in login and security settings; spell it out in buttons. |
| S3 service | **file storage** | Its container is a **bucket** in both languages, retaining the vendor term. |
| short-lived migration key | **import key** | Heading: “Import keys”; avoid “migration API key”. |
| setup status pair | **Configured / Not configured** | One adjectival pair in the checklist and Integrations; avoid “Not set”. |
| invoicing vendor | **iFirma** | Lowercase i, capital F in all headings, labels, and provider options. |
| notification | **notification** | Thread reply: “reply in the discussion”. Staff `dm-report`: “{person} reported a direct conversation”. |
| email notification preferences | **manage notifications** | Footer links to the thread or space owning the mute/unfollow control. |
| terms | **terms of service** | Tenant-configured BYO URL. Consent: “I accept the terms of service and privacy policy”. |
| privacy document | **privacy policy** | Same consent surface as terms. |
| staff viewing the community as a member | **member view** | Entry: “View as”; banner: “Viewing as {name}”; exit: “Back to the panel”. Avoid implementation jargon such as “impersonation”. |
| connected service | **integration** | Proper nouns and vendor terms such as Stripe, Bunny Stream, restricted key, and webhook remain untranslated; translations may add a gloss. |

## Action verbs

| Action | English | Notes |
|---|---|---|
| cancel an unfinished flow | **Cancel** | Payment/subscription state: canceled. |
| dismiss a completed dialog | **Close** | `common.close`; replaces Cancel after success. |
| save | **Save** | |
| create | **Create** | |
| add | **Add** | |
| destroy content | **Delete** | Lessons, chapters, posts. |
| take out of a collection | **Remove** | “Remove member” remains the conventional exception even when data is deleted; explain the impact in the dialog. |
| revoke access | **Revoke** | |
| renew | **Renew** | |
| publish | **Publish** | |
| manage | **Manage** | |
| upload a file | **Add …**, progress **Uploading…** | The Polish dictionary uses one pair for images, downloads, and attachments. English is not yet unified: image assets still say “Upload file”. |
| irreversible action notice | **This cannot be undone.** | Use this exact sentence consistently. |

## Error-message tone

- Address the user directly. English uses plain “you”; Polish uses the polite
  capitalization of personal pronouns where grammar requires it.
- Be actionable and avoid blame: explain what happened and what to do next,
  for example “Check your details and try again.”
- Avoid gendered past-tense forms addressed to the user. Prefer present tense,
  imperatives, or nouns. Parenthesized third-person gender alternatives are allowed.
- Do not leak internal backend messages. Identify diagnostic codes as “Trace ID”.
- Use short, human headings such as “Something went wrong” or “Nothing here”.
  Put details in the body.

## Mechanics per language

- **Buttons:** sentence case in both languages (D6). Capitalize proper nouns,
  as in “Continue with Google” and “Choose from Bunny Stream”.
- **Field labels:** lowercase, such as “email” or “new password”. Table columns
  and section headings use sentence case.
- **Quotes:** Polish uses lowered opening quotes; English uses curly quotes.
  Avoid straight quotation marks in product copy.
- **Dashes:** spaced em/en dashes for asides, not bare hyphens.
- **Ellipsis:** a single `…` for progress states, such as “Saving…”.
- **Numbers and currency:** use `Intl` with `pl-PL` / `en-GB`
  (`apps/web/src/lib/format.ts`). Polish uses a decimal comma and trailing
  currency symbol; English uses `PLN 399.00`. Follow the same convention in examples.
- **Dates:** `Intl` with `dateStyle: 'medium'`; never format by hand.
- **Email spelling:** hyphenated in Polish, “email” in English.
- **Polish plurals:** use the three-form `plural(one, few, many)` helper.
  Include agreeing adjectives in the plural forms or rephrase so count = 1 works.
- **Duration:** localized hour abbreviation; “h” in English, “min” in both.

## Polish translation vocabulary

Do not import these English nouns into Polish copy: member, workspace, tenant,
checkout, bare billing, draft, feature, dashboard, progress, community.
Use the canonical translations in `pl.ts`. The rejected subscriber synonym
also stays excluded. Technical proper nouns are allowed: Stripe, webhook,
restricted key, PDF, HTML, CSV, JSON. Add a parenthesized gloss where appropriate.

## Decision log

Polish wording is recorded in the dictionaries; this log describes the decisions
and affected keys in English.

1. Use the broad member concept rather than a course-only student or formal
   club-member term. Corrected `billing.intro`.
2. Initially called the tenant a space and removed workspace from
   `tenant.openingWorkspace` and `resetPassword.eyebrow`. Superseded by 23.
3. Separate owner/admin/member roles, the creator persona, and collective staff.
4. Standardize the grant verb in checkout success copy.
5. Use distinct verbs for revocation and the free-claim CTA.
6. Standardize checkout link in `checkout.unavailableBody`,
   `products.copyCheckoutLink`, and `checkoutLinkCopied`.
7. Standardize adjective-first Polish magic-link phrasing in
   `auth.registeredBoughtHint` and `auth.registeredUseMagicLinkCta`.
8. Standardize attach/detach in `courses.detachModule*` and
   `products.unreachable*Label`.
9. Use American **canceled** in `checkout.cancelledEyebrow`. Historical key
   spelling remains because keys are API; values are copy.
10. Use **Delete** for content destruction in `courses.removeChapter` and
    `removeChapterLessonCount`; retain **Remove member** as the conventional exception.
11. Standardize **This cannot be undone.** in `lessons.deleteConfirmIntro`.
12. Avoid a customer noun before purchase in `sales.emptyBody`.
13. Make shared-module warnings grammatical for count = 1 in
    `courses.detachModuleSharedNote` and `courses.removeChapterSharedWarning`.
14. Replace developer jargon “dangling references” with “broken references”
    in `products.accessIssues*` and the corresponding Polish wording.
15. Rephrase `lesson.videoPlaceholder` in both languages, removing a literal
    translation and punctuation hyphen.
16. Rephrase the Polish magic-link disclaimer, standardize one-hour validity,
    and name the password-reset link consistently.
17. Remove gendered forms addressed to the user in purchased-course prompts.
18. Give `members.joined` an explicit joining-date label in Polish.
19. Confirm canonical course/module/chapter/lesson, discussion/thread/post,
    product/price/subscription/order, Cancel, Overview, draft, passkey, and
    `Intl` price formatting.
20. Correct the Polish verb for an unfinished payment in `checkout.cancelledTitle`.
21. Align `student.grantUpcomingNote` with the label: access starts on the date.
22. Initially proposed a zone term for community spaces to distinguish them
    from tenants and chat channels. Superseded by 23.
23. Reserve the Polish platform term for tenants and the space term for
    community spaces, superseding 2 and 22. Applied to auth, splash, chooser,
    branding, support, email settings, and transactional emails. A shared
    product-level pool is called **Together**. English uses **workspace**.
24. Use one two-factor authentication term in login and security settings.
25. Creator copy names the checkout surface; buyer copy names the payment step.
26. Standardize file storage/bucket, payment provider, import keys,
    Configured/Not configured, free preview lesson, and file-upload vocabulary.
27. Retain the colloquial ban term in moderation confirmations, distinct from blocking.
28. Apply **iFirma** trademark casing in invoicing headings, username labels,
    and provider options in both languages.
29. Default setup errors are member-safe. Creator hints belong in
    `errors.panelHint*` and `localizeErrorCodeForPanel`; integration instructions
    must not leak into member surfaces.
30. Keep private block/unblock distinct from staff bans. Use report conversation
    for `dm-report`, and plain staff in report acknowledgments.
31. Use `common.close` to dismiss successful dialogs, replacing Cancel.
32. Use member view instead of impersonation or a generic preview-mode label.
    Restrictions on preview terminology apply to free samples, not this concept.
33. Use **messages** consistently on the member surface, including member-view copy.
