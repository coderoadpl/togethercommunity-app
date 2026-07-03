# Prompt dla agenta architektury (agentproofarch) — SSR/SEO + model tożsamości kursantów

> Utworzony 2026-07-03. Do wklejenia agentowi pracującemu w repo coderoadpl/agentproofarch.
> Dotyczy otwartych pytań 16 i 17 z tasks/prd-together.md.

```text
Kontekst produktu (Together), dla którego agentproofarch jest fundamentem:
platforma multi-tenant dla twórców internetowych — sprzedaż produktów
cyfrowych (kursy, ebooki, członkostwa), delivery kursów, społeczność
i e-mail marketing. Hosted na Vercelu + darmowy self-host (docker compose).
Publiczne strony sprzedażowe produktów to główny kanał ruchu twórców.
Dwie populacje użytkowników: twórcy z zespołami (pasują do obecnego modelu
organizacji) oraz kursanci/członkowie — klienci końcowi każdego tenanta.
PRD produktu: repo coderoadpl/together, tasks/prd-together.md (przeczytaj,
jeśli masz dostęp; kluczowy kontekst jest też poniżej).

Mam dwa tematy architektoniczne do rozstrzygnięcia i wprowadzenia do PRD
fundamentu (tasks/prd-agentproofarch-foundation.md):

TEMAT 1 — Publiczne strony z SEO vs "No SSR, no Next.js" (FR-16, §6).
Produkt wymaga publicznych, SEO-krytycznych stron per tenant (strony
produktów/sprzedażowe, landing pages, publiczne strony społeczności):
pełne meta tagi OG/Twitter w HTML, indeksowalność przez wszystkie boty
(nie tylko Google), szybki first paint. Czyste statyczne SPA tego nie
spełnia. Jestem otwarty na SSR "gdzieniegdzie" — Vercel jest do tego
stworzony — ale nie chcę wywracać architektury.
Zaprojektuj i wpisz do PRD warstwę renderowania stron publicznych, która:
- zachowuje reguły warstw (core bez frameworków, boundaries lint-enforced),
- działa z tego samego commita na obu targetach (Vercel Functions + kontener
  Node w self-host), z sensownym cache (strony per tenant, unieważnianie po
  zmianie treści),
- zostawia SPA dla części zalogowanej (panel twórcy, widok kursanta).
Rozważ co najmniej: (a) SSR publicznych route'ów w Hono (np. hono/jsx),
współdzielący view-modele z core; (b) wstrzykiwanie meta tagów do index.html
+ prerender/cache najważniejszych stron; (c) hybryda a+b. Jeśli uznasz, że
jednak Next.js jest właściwym trade-offem, napisz wprost dlaczego warto
odwrócić tę decyzję. Dodaj user stories i zaktualizuj FR-16/Non-Goals.

TEMAT 2 — Model tożsamości kursantów (§3.4).
Obecnie: 1 e-mail = 1 globalne konto + członkostwa w organizacjach. Dla
twórców/zespołów to pasuje. Pytanie: czy kursanci (klienci końcowi tenanta)
powinni być globalnymi userami z per-tenantowym profilem członka, czy osobną
encją per tenant poza organizacjami Better Auth?
Moja intuicja: model globalny nam nie przeszkadza — zwaliduj ją i zaprojektuj
rekomendowany wariant tak, żeby spełniał twarde wymagania produktu:
- relacja z klientem należy do twórcy: profil członka, tagi i zgody
  marketingowe (RODO) przechowywane per tenant, nie na globalnym koncie,
- pełny eksport danych członków per tenant (CSV/JSON, z e-mailami),
- ten sam e-mail może być klientem wielu tenantów; członek nie może przez
  swoje konto zobaczyć listy innych tenantów (prywatność),
- twórca może usunąć członka ze SWOJEGO tenanta (semantyka: usunięcie
  członkostwa + danych tenant-scoped vs usunięcie globalnego konta),
- konto członka powstaje też bez hasła, z webhooka Stripe po zakupie
  (logowanie magic linkiem),
- sesje/cookies na custom domenach tenantów: cookie nie obejmie cudzej
  custom domeny — opisz, jak wygląda logowanie per domena vs subdomeny
  APP_BASE_DOMAIN, i co z tego wynika dla członków.
Zaktualizuj §3.4 (model tożsamości) i dopisz decision record z uzasadnieniem
oraz konsekwencjami dla RODO (kto jest administratorem danych członków).

Oba tematy: najpierw krótka propozycja decyzji (żebym mógł zatwierdzić),
potem aktualizacja PRD i ewentualne user stories. Nie implementuj przed
zatwierdzeniem decyzji.
```
