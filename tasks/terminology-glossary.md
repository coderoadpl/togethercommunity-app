# Together — PL/EN terminology glossary

Canonical terminology for every user-facing surface: web dictionaries
(`apps/web/src/i18n/pl.ts`, `en.ts`), error messages (`errors` section +
`errors.ts` mapping), transactional e-mails (`core/domain/transactional-email.ts`),
and any future copy. One concept = one Polish term = one English term.
Voice: competent, warm, never corporate. If a term is not listed here, add it
here first, then use it.

## Personas & roles

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| member (a person with access in a space) | **uczestnik** | **member** | DECIDED over „kursant" (course-only — too narrow for a course+community product) and „członek" (cold, club-like). Use everywhere: panel, student pages, e-mails. „Kursant"/„członek" are FORBIDDEN in user-facing copy. Seed data display names may keep legacy „Kursant …" fixtures. |
| creator (the person who runs a space) | **twórca** | **creator** | Persona word — used when describing whose space/panel it is („panel twórcy", "another creator's space"). Never a role label. |
| owner (role) | **właściciel** | **owner** | Role labels only (member list, role chips). |
| admin (role) | **administrator** | **admin** | Role label. „Administrator" is NOT a synonym for „twórca": twórca = persona, administrator = permission level. |
| staff (owner+admin collectively) | **zespół** | **staff** | e.g. „uprawnienia zespołu" / "staff access". |
| customer / buyer before signup | *(avoid the noun)* | *(avoid the noun)* | DECIDED: pre-purchase visitors are not named („Udostępnij link do zakupu…", "Share a checkout link…"). Never „klient"/"customer" — the moment they buy, they are uczestnik/member. |

## Commerce

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| product | **produkt** | **product** | The sellable unit. A product *grants access* to course content. |
| course | **kurs** | **course** | Content unit. Products ≠ courses; never mix („kup kurs" only when the product is literally one course — default to „kup produkt"/„link do zakupu"). |
| price | **cena** | **price** | One-time = „jednorazowa" / "one-time"; recurring = „cykliczna" / "recurring"; kind = „rodzaj ceny" / "price kind"; billing interval = „okres rozliczeniowy" / "billing interval". |
| subscription | **subskrypcja** | **subscription** | Never „abonament". Statuses: aktywna/active, zaległa płatność/payment past due, anulowana/canceled. |
| order | **zamówienie** | **order** | Statuses: opłacone/paid, oczekujące/pending, nieudane/failed, zwrócone/refunded (lowercase in tables). |
| grant (an access entitlement) | **dostęp** (long: **przyznany dostęp**) | **grant** | Verb: **przyznać** / **grant** — ALWAYS „przyznać", never „nadać" (fixed: checkout success copy). States: aktywny/active, wygasły/expired, bezterminowo/perpetual. |
| to revoke a grant | **cofnąć dostęp** | **revoke** | DECIDED: „cofnij", not „odbierz" — „odbierz" collides with the claim-CTA „Odbierz za darmo" (opposite directions of the same verb). |
| to claim for free | **odbierz za darmo** | **get it for free** | Checkout CTA; unambiguous now that revoke = „cofnij". |
| checkout (page/flow) | **płatność** | **checkout** | Page eyebrow „płatność", loading „Ładowanie płatności…". |
| checkout link | **link do zakupu** | **checkout link** | DECIDED: one PL term (was mixed with „link do płatności") and one EN term (was mixed with "purchase link"). |
| billing portal | **portal płatności** | **billing portal** | Student-side section heading: „Płatności" / "Payments"; CTA „Zarządzaj płatnościami" / "Manage payments". |

## Content structure

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| course | **kurs** | **course** | |
| module | **moduł** | **module** | Reusable between courses. |
| chapter | **rozdział** | **chapter** | Lives inside a module. |
| lesson | **lekcja** | **lesson** | |
| content block | **blok treści** (short: blok) | **content block** (short: block) | |
| curriculum / syllabus | **program kursu** | **course curriculum** (eyebrow: "course syllabus") | |
| attach / detach a module | **podepnij / odepnij** | **attach / detach** | DECIDED: „podepnij/odepnij" pair everywhere — never „odłącz/podłącz" (was mixed). Derived forms: „odpięte od kursu" / "detached from the course". |
| draft / published | **wersja robocza / opublikowany** | **draft / published** | |
| library (student's) | **biblioteka** | **library** | „Tego kursu nie ma w Twojej bibliotece." |

## Community

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| discussion (per lesson) | **dyskusja** | **discussion** | |
| thread | **wątek** | **thread** | |
| post (a message in a thread) | **wpis** | **post** | Verb: „Opublikuj" / "Post". Reply = „odpowiedź" / "reply", verb „Odpowiedz" / "Reply". |
| follow a thread | **obserwuj wątek** | **follow thread** | Muted = „wyciszono" / "muted". |
| community space (feed area inside a tenant) | **strefa** | **space** | DECIDED (2026-07-20, spaces core): „przestrzeń" is taken by tenant, so community spaces are „strefy" („strefa Społeczność", „wpis w strefie"). EN keeps "space" — tenant copy avoids the bare noun there, so no collision in practice. „Strefa" inflects normally: „w strefie", „obserwuj strefę". |
| reaction (emoji on a post) | **reakcja** | **reaction** | Closed emoji set: 👍 ❤️ 🎉 💡 😂. Verb: „zareaguj" / "react". |
| follow a space | **obserwuj strefę** | **follow space** | Same verb as thread follow; unfollow = „przestań obserwować" / "unfollow". |

## Platform

| Concept | PL | EN | Decision notes |
|---|---|---|---|
| tenant (user-facing) | **przestrzeń** | **space** | DECIDED: users NEVER see „tenant". EN is "space" everywhere — "workspace" is forbidden (was mixed). „Przestrzeń" takes normal inflection: „adres przestrzeni", „Nieznana przestrzeń". |
| account | **konto** | **account** | |
| magic link | **magiczny link** | **magic link** | DECIDED word order: adjective first — „magiczny link", „zaloguj się magicznym linkiem" (was mixed with „link magiczny"). |
| passkey | **klucz dostępu** | **passkey** | |
| two-factor authentication | **uwierzytelnianie dwuskładnikowe** | **two-factor authentication** | EN buttons spell it out ("Enable two-factor authentication"). |
| notification | **powiadomienie** | **notification** | Kinds so far: thread reply = „odpowiedź w dyskusji" / "reply in the discussion". |
| manage notifications (e-mail footer) | **zarządzaj powiadomieniami** | **manage notifications** | Opt-out footer in community notification e-mails; links the thread/space surface that owns the mute/unfollow toggle. |
| terms of service | **regulamin** | **terms of service** | Tenant-configured BYO URL (panel Settings). Consent copy: „Akceptuję regulamin i politykę prywatności" / "I accept the terms of service and privacy policy". |
| privacy policy | **polityka prywatności** | **privacy policy** | Same consent surface as regulamin; inflected „politykę prywatności" in the checkbox copy. |
| integration | **integracja** | **integration** | Third-party proper nouns (Stripe, Bunny Stream, restricted key, webhook) stay untranslated; PL may gloss them in parentheses. |

## Action verbs (buttons)

| Action | PL | EN | Notes |
|---|---|---|---|
| cancel (a dialog/flow) | **Anuluj** | **Cancel** | Never „Przerwij". A canceled payment/subscription = „anulowana" / "canceled". |
| save | **Zapisz** | **Save** | |
| create | **Utwórz** | **Create** | |
| add | **Dodaj** | **Add** | |
| delete (destroy content, irreversible) | **Usuń** | **Delete** | EN: "Delete" whenever data is destroyed (lessons, chapters, posts). |
| remove (take out of a collection) | **Usuń** | **Remove** | PL uses „Usuń" for both; EN distinguishes. Exception kept by convention: "Remove member" (industry standard), even though it deletes their data — the dialog spells out the impact. |
| revoke | **Cofnij dostęp** | **Revoke** | |
| renew | **Odnów** | **Renew** | |
| publish | **Opublikuj** | **Publish** | |
| manage | **Zarządzaj** | **Manage** | |
| irreversibility notice | **Tej operacji nie można cofnąć.** | **This cannot be undone.** | One canonical sentence (was mixed with „Ta operacja jest nieodwracalna."). |

## Error-message tone

- PL addresses the user per „ty", capitalized „Ty/Twój" (grammar-required forms
  only, no shouting). EN uses plain "you".
- Actionable, no blame: say what happened + what to do next
  („Sprawdź wprowadzone dane i spróbuj ponownie."), never accuse
  („podałeś zły…" is forbidden — also because it is gendered, see below).
- No gendered past-tense forms addressed to the user. Rephrase to
  present/imperative/noun forms: „Masz tu kupiony kurs?" not „Kupiłeś kurs?".
  Third-person „odpowiedział(a)" with the parenthesis is allowed.
- Never leak internals: no raw backend messages, codes only as „Identyfikator
  śledzenia" / "Trace ID".
- Headings are short and human („Coś poszło nie tak", "Nothing here"); details
  go in the body sentence.

## Mechanics per language

- **Button casing**: sentence case in both languages (per D6). Only proper
  nouns capitalized ("Continue with Google", „Wybierz z Bunny Stream").
- **Field labels**: lowercase in both languages („e-mail", "new password").
  Table column headers and section headings: sentence case.
- **PL quotes**: „lowered-raised" („nazwa"); **EN quotes**: “curly” — never
  straight `"` in copy.
- **Dashes**: spaced em/en dash „ — " for asides in both languages; never a
  bare hyphen as punctuation.
- **Ellipsis**: single char `…` for in-progress states („Zapisywanie…",
  "Saving…").
- **Numbers/currency**: rendered via `Intl` with `pl-PL` / `en-GB`
  (`apps/web/src/lib/format.ts`): PL `399,00 zł` (comma decimal, symbol after),
  EN `PLN 399.00`. Hand-written examples follow the same convention
  (PL „np. 199,99", EN "e.g. 199.99").
- **Dates**: via `Intl` `dateStyle: 'medium'` — never hand-formatted.
- **PL e-mail**: always hyphenated „e-mail"; EN always "email".
- **PL plurals**: always the 3-form `plural(one, few, many)` helper — never
  a bare „{count} lekcji". Include agreeing adjectives inside the plural forms
  or rephrase so the sentence works for count = 1 („występuje też w 1 innym
  kursie").
- **Duration**: PL „godz." / „min", EN "h" / "min".

## Forbidden anglicisms (PL)

Never in Polish copy: „member", „workspace", „tenant", „checkout" (as a noun),
„billing" (bare), „subskrybent", „draft", „feature", „dashboard" (use
„przegląd"), „progress" (use „postęp/postępy"), „community" (use
„społeczność"). Technical proper nouns are fine (Stripe, webhook, restricted
key, PDF, HTML, CSV, JSON) — gloss in parentheses when a PL label exists
(„klucz ograniczony (restricted key)").

## Decision log (all decisions, including no-change confirmations)

1. member = **uczestnik** (rejected: kursant, członek). Fixed „Kursanci" in
   `billing.intro`.
2. tenant = **przestrzeń** / **space**; "workspace" purged from EN
   (`tenant.openingWorkspace`, `resetPassword.eyebrow`).
3. Roles: właściciel/owner, administrator/admin, uczestnik/member; persona:
   twórca/creator; collective: zespół/staff.
4. grant = dostęp/grant; verb **przyznać** (fixed „nadany" →
   „przyznany" in checkout success copy).
5. revoke = **cofnij dostęp** (was „odbierz") to free „odbierz" for the
   claim-CTA „Odbierz za darmo".
6. checkout link = **link do zakupu** / **checkout link** (fixed „link do
   płatności" in `checkout.unavailableBody`, "purchase link" in
   `products.copyCheckoutLink` + `checkoutLinkCopied`).
7. magic link = **magiczny link**, adjective-first in every inflection (fixed
   `auth.registeredBoughtHint`, `auth.registeredUseMagicLinkCta`).
8. attach/detach = **podepnij/odepnij** (fixed „odłącz…" in
   `courses.detachModule*`, „odłączone" in `products.unreachable*Label`).
9. EN spelling: American **canceled** (fixed `checkout.cancelledEyebrow`;
   key names keep their historical spelling — keys are API, values are copy).
10. EN destructive verb: **Delete** for content destruction (fixed
    `courses.removeChapter`, `removeChapterLessonCount`); **Remove member**
    kept as the industry-standard exception.
11. Irreversibility sentence standardized: „Tej operacji nie można cofnąć." /
    "This cannot be undone." (fixed `lessons.deleteConfirmIntro`).
12. No customer noun pre-purchase (fixed `sales.emptyBody` both languages).
13. Shared-module warnings rephrased so count = 1 is grammatical in both
    languages (`courses.detachModuleSharedNote`,
    `courses.removeChapterSharedWarning`).
14. „dangling references" (dev jargon) → "broken references" /
    „nieprawidłowe odwołania" (fixed EN `products.accessIssues*`).
15. `lesson.videoPlaceholder` rephrased in both languages (was a calque with a
    bare hyphen).
16. E-mail copy: PL magic-link disclaimer rephrased (was „Jeśli nie prosisz o
    tę wiadomość…"), link validity standardized to „ważny przez godzinę",
    reset e-mail uses „link do zresetowania hasła".
17. Gendered forms addressed to the user removed („Kupiłeś tutaj kurs?" →
    „Masz tu kupiony kurs?").
18. `members.joined` PL = „Data dołączenia" (was the bare noun „Dołączenie").
19. Confirmed unchanged (already canonical): kurs/moduł/rozdział/lekcja;
    dyskusja/wątek/wpis; produkt/cena/subskrypcja/zamówienie; „Anuluj" (no
    „przerwij" existed); sekcja „Przegląd"/"Overview"; „wersja
    robocza"/"draft"; „klucz dostępu"/"passkey"; price formatting via `Intl`.
20. `checkout.cancelledTitle` PL: „Płatność nie została dokończona" (was
    „ukończona" — payments are „dokańczane", courses are „ukańczane").
21. `student.grantUpcomingNote` aligned with its label: „Dostęp rozpocznie
    się {date}." (was „otworzy się").
22. community space = **strefa** / **space** (rejected: „przestrzeń" — tenant,
    „kanał" — chat-like, „grupa" — collides with FB groups). New notification
    kind copy: space post = „nowy wpis w strefie" / "new post in the space".
