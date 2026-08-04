# Raport: PoC Together + sprint parity + audyty (2026-07-12 → 2026-07-14)

> Branch: `poc-together` · PR: https://github.com/coderoadpl/togethercommunity-app/pull/1
> Stan bramek na HEAD (`b7124c0`): `npm run check` — 246 testów zielonych
> (typecheck + eslint boundaries + dependency-cruiser + vitest), `npm run smoke`
> — PASS. Każdy commit poniżej przeszedł obie bramki przed wejściem na branch.

## 1. Fundament PoC (2026-07-12)

| Commit | Zakres |
|---|---|
| `b45261c` | PRD: konsekwencje ADR-0001/0002 (FR-35/US-030 → headless API + checkout links; FR-3 → własność relacji) |
| `81e2772` | Bootstrap `app/` ze szkieletu agentproofarch/demo, rebranding, porty 48730/48731/48912 |
| `f8954f3` | `todos` → `products` przez wszystkie warstwy + `contentVersion` tenanta |
| `376414b` | Publiczne read-only offer API (open CORS, ETag/304 z wersją treści) |
| `ce927cd` | `ensureMember`, symulowany zakup, granty, magic link z dev-echo (FR-20/21) |
| `73987c5` | Web twórcy: rejestracja, tworzenie tenanta, panel z Products |
| `cf738e8` | Shareable checkout + widok kursanta (stub kursu) |
| `ff34d8c` | Passkeys + TOTP 2FA + Google (gated na env) za `AuthClientPort`; `e2e:auth` |
| `3e67d0f` | Lista członków + eksport CSV/JSON (owner/admin) |
| `81d2eea` | `e2e:poc` — 10-krokowy scenariusz CLI na świeżej bazie (docker :49217) |
| `9957d8d` | Naprawy z adversarial review (cache błędów, transakcje, FR-22 removeMember, TOCTOU, fail-closed) |
| `230fa6a` | Screenshoty PoC (playwright + Chrome) |
| `46b4d65` | Fix DX: `dev:server` ładuje `.env` (bug „Authentication required" na checkoutcie) |

Audyt fundamentu (fable + gpt-5.6-sol, konsensus): warstwa enforcement
nietknięta względem dema (eslint/depcruise bajt-w-bajt modulo rename, zero
escape'ów w całym diffie). Naprawy: `7412e0c` (CLI auth-config FR-14, martwe
porty) i `f157bfd` (allowlista zależności zewnętrznych per warstwa, pola
agregatu member: tags/consents/externalCustomerIds, odświeżanie snapshotu
e-maila, zod na wejściu CLI).

## 2. Motywy (2026-07-12/13)

`32694fd` rejestr mode'ów + selektor Autocomplete + fonty (fable) ·
`42d2562` Quiet Studio (fable) · `e9bcc56` Scoreboard (gpt-5.6-sol) ·
`f21d0ac` Signal Mono (gpt-5.6-sol) · `2ec298b` Steady Frame (opus po limicie
fable) · `47cc089` 12 screenshotów per motyw + przegląd wizualny.
Sześć motywów: Logbook (default), Material, Quiet Studio, Scoreboard,
Signal Mono, Steady Frame — przełącznik w headerze, persystencja lokalna.

## 3. Sprint parity z legacy (2026-07-13)

Kontrakt: `tasks/mvp-parity.md` (mapowanie legacy→Together + decyzje ownera).
Rekonesans legacy (legacy stack) z cytowaniami file:line:
prywatne artefakty audytowe właściciela.

| Workflow | Commity | Zakres |
|---|---|---|
| W1 backend core | `c8160c6`, `49a9021`, `944f55f` | Model treści w kształcie legacy (moduły z `chapters[]` jsonb, typowane bloki lekcji video/embed/pdf/link/html), accessItems, granty czasowe, progress; 3-stanowa dostępność + roll-up ukończeń + next-lesson; 7 route'ów studenckich + CRUD admina + pełne CLI |
| W2 M2M/e-mail/auth | `4f4e8d3`, `df794f9`, `af749d7` | `EmailPort` (SES + dev sink) + szablony PL/EN; klucze API tenanta + `POST /api/m2m/enroll` z semantyką renew; weryfikacja PBKDF2 Payloada (niewidzialna migracja haseł) |
| W3 student web | `208816e`, `a98500f`, `3fe7063` | Katalog "Moje kursy", drzewo z kłódkami/checkmarkami/searchem, player bloków (HTML sanityzowany dompurify), complete/next/breadcrumbs, stan locked; screenshoty |
| W4 panel twórcy | `198fccb`, `89715c1`, `256a4cf` | Edytor drzewa kursu (moduły/rozdziały/lekcje z blokami), edytor dostępów produktu, granty membera (grant/renew/revoke); screenshoty |
| W5 i18n | `4105675`, `20a86fc` | Typowane słowniki PL/EN (wyczerpywalność kompilacyjna), przełącznik języka, pełne pokrycie UI, daty locale-aware |
| W6 seed demo | `9c3e4a7` | 3 tenanty, 3 kursy z realistyczną polską treścią, 4+1 produkty (3 poziomy dostępu + free preview "1 lekcja/moduł"), kursanci w każdym stanie grantu, idempotencja udowodniona |

## 4. W7a — przebudowa modelu dostępów i fixy (2026-07-13/14)

- `7951d6b` — **AccessItem jako unia dyskryminowana** `course(+excludedModuleIds) | modules | lessons` (kształt bool+tablice był wymuszony Payloadem); migracja danych 0008; **wyjątki modułów** (course-access minus moduły, nadpisywalne grantem modułowym); **higiena martwych referencji** (resolver ignoruje, `listProductAccessIssues` + chip w panelu + CLI); edytor **Easy/Pro**.
- `039d7da` — **magic linki na hoście tenanta** (per-domain cookie worlds, ADR-0002; bug znaleziony przez browser-probe); **język UI → maile** z checkoutu i loginu; **prawdziwe publiczne wideo Bunny Stream** w seedzie (biblioteka 197133, zweryfikowane HTTP).
- `ccde7be` — **panel w klasycznym shellu AppBar + Sidebar** (permanent ≥md, hamburger mobile), spójny w 6 motywach; screenshoty przestrzelone.

## 5. W7b — audyt przez żywe UI: 3 soczewki × 2 boty

Metoda: każdy audytor samodzielnie klikał aplikację w prawdziwej przeglądarce
(fable: własny headless Chrome + ogląd screenshotów; gpt-5.6-sol: connectOverCDP
do przygotowanych instancji Chrome), logując się na konta demo.
Wykonanie: fable 3/3, sol 1/3 (A i C ubite w trakcie — odnotowane).
Artefakty (~60 screenshotów + raporty) oraz synteza `SYNTHESIS.md`:
prywatne artefakty audytowe właściciela.

**Werdykty (stan PRZED pętlą napraw):**
- **A (parity):** rdzeń studencki zgodny z kontraktem legacy; audyt znalazł
  2 braki blokujące pełne parity (brak powierzchni konta membera; nieosiągalna
  lekcja wideo przez bug seedu) — oba naprawione w `b7124c0`. Stan PO
  naprawach potwierdza osobna certyfikacja (sekcja 5a).
- **B (kompletność i dojrzałość UX, obaj boci zgodni):** główna pętla produktu
  przechodzi bez zacięć od checkoutu po odtwarzanie kursu z postępem, a
  możliwości pod spodem (poziomy dostępu z wyjątkami, granty czasowe, izolacja
  tenantów, 6 motywów, PL/EN) są na miejscu — ale wykończenie ekranów jest
  surowe: brak wyszukiwania w listach admina, puste stany bez podpowiedzi,
  edycja lekcji surowym HTML-em, brak procentów postępu u kursanta. Krótko:
  silnik lepszy niż karoseria; karoseria = lista should-fix.
- **C (vs PRD, z dowodami DB/API):** izolacja tenantów wytrzymała ataki,
  ADR-0001 działa jak obiecano; luki dotyczą kompletności featurów, nie
  fundamentów. Fałszywe znalezisko sola („zepsute completion") obalone
  w syntezie i odrzucone.

**Must-fixy — naprawione w `b7124c0`:**
1. Osierocona lekcja Bunny (seed `onConflictDoNothing` nie odświeżał struktury
   → teraz upsert; granty/progres nietknięte).
2. Ostrzeżenia o martwych referencjach sprawdzały istnienie id, nie
   osiągalność w drzewie → teraz produkty sprzedające odpięte treści są flagowane.
3. Member bez powierzchni konta (logout/reset/billing-link) → dodana.

## 5a. Certyfikacja parity po naprawach (2026-07-14)

Osobny audytor przeszedł checklistę parity w przeglądarce, stemplując każdą
pozycję dowodami (screenshoty + logi sieciowe): **11 PASS / 2 PARTIAL / 1 FAIL
= 85,7%**. Oba wcześniejsze blokery potwierdzone jako naprawione (realny stream
Bunny gra: HLS 200, video readyState=4; completion/roll-upy działają).
Pozostałe braki:

| Pozycja | Status | Sedno |
|---|---|---|
| Profil membera: reset hasła + link do billing portal | **FAIL** | powierzchnia konta z `b7124c0` ma tylko „wyloguj się"; brak akcji resetu i linku billingowego |
| Maile forgot/reset password | PARTIAL | szablon `resetPassword` istnieje, ale nie ma konsumenta ani strony resetu — member zawsze może wejść magic linkiem, ale nie może ustawić/zmienić hasła |
| Inline podgląd PDF | PARTIAL | mechanizm zgodny z legacy (iframe + „otwórz w karcie"), ale seedowany PDF z w3.org **zabrania framingu** (CSP frame-ancestors) — wada danych demo, nie kodu |

**AKTUALIZACJA (2026-07-14 23:10): PARITY = 100%.** Wszystkie 3 pozycje
naprawione w `8152716` (strona /account membera z pełnym cyklem ustawienia/
resetu hasła — mail z szablonu na hoście tenanta, hasło współistnieje z magic
linkiem; `billingPortalUrl` jako ustawienie tenanta z warunkowym linkiem
„Zarządzaj płatnościami"; seedowany PDF przeniesiony na same-origin
`/assets/sample-lekcja.pdf` — renderuje się inline) i **re-certyfikowane 3×PASS**
przez audytora w przeglądarce (screenshoty: prywatne artefakty audytowe
właściciela). Ciekawostka
procesowa: zmiana `pdfUrl` uruchomiła tripwire wersjonowania snapshotów —
wymusił podbicie schematu lekcji v1→v2 z upcasterem, dokładnie tak, jak miał.

**Should-fix (9) i Later (6):** pełna lista w prywatnym archiwum właściciela
(reordering w builderze, routing URL panelu, rich-text z podglądem, fałszywy
chip „Kurs ukończony", osadzalne embedy w seedzie, wycieki angielskich błędów,
cena w groszach, UX dodawania lekcji; dalej: progress %/resume, upsell z
zablokowanych treści, wyszukiwanie w adminie, dashboard twórcy, luki roadmapowe).

## 6. Znane odstępstwa i stuby

- `ensureUser` robi bezpośredni insert do tabeli `user` providera (Better Auth
  1.6.23 nie ma passwordless-create) — odizolowane w `adapters/auth`.
- Realny Stripe zastąpiony symulacją (`SIMULATED_PAYMENTS`, prod fail-closed);
  ścieżka komercyjna legacy = `POST /api/m2m/enroll` (jest, z kluczami API).
- Wersjonowanie treści odłożone (decyzja ownera); import przeniesie bieżące dokumenty.
- Embeddy `/embed/*` post-MVP per ADR-0001.

## 7. Co dalej

1. Testy manualne ownera na seedzie (dane kont demo w prywatnych materiałach
   oraz w `app/README.md`, sekcja „Demo data").
2. Should-fixy z audytu (osobny sprint).
3. Projekt importu: eksporter z dumpa Mongo → `together import --dry-run`
   → raport różnic stary-vs-nowy (transformacja accessItems opisana w
   `tasks/mvp-parity.md`).
4. Środowiska Vercel (dev/staging/prod) — odłożone decyzją ownera do czasu parity.
