# PRD: Together — platforma Fair Source dla twórców

> **Status:** Założenia projektowe — wersja 2 (2026-07-02, po feedbacku założyciela).
> **Nazwa:** Together (zdecydowana). Domena otwarta — warianty domen do sprawdzenia (lista w prywatnych materiałach).
> **Cel dokumentu:** baza do wygenerowania wykonywalnych zadań. Nie jest to spec implementacyjny.
> **Decyzje przyjęte bez potwierdzenia** oznaczone są ⚠️ i zebrane w sekcji „Otwarte pytania".
> **Poprzednia iteracja projektu (VI 2025):** archiwum poprzedniej iteracji w prywatnych materiałach właściciela (project-description, prd, tech-stack) — ten dokument ją zastępuje, ale czerpie z niej rozwiązania (poziomy dostępu publiczne/płatne/ukryte, zarządzanie członkostwem przez API).
> **Reality audit (2026-08-03):** acceptance-criteria checkboxes reflect verified code. Ticked = shipped and evidenced; unticked = partial or missing. Remaining phase-0/1 work is packaged in `tasks/phase1-gaps.md`.

---

## 1. Wstęp / Wizja

Platforma typu Circle.so łącząca w jednym narzędziu cztery filary pracy twórcy internetowego:

1. **Sprzedaż** produktów cyfrowych (kursy, ebooki, członkostwa),
2. **Marketing** (e-mail, landing pages, automatyzacje, kupony),
3. **Delivery** — dostarczanie zakupionych produktów (odtwarzanie kursów, pobieranie plików, kontrola dostępu),
4. **Społeczność** (spaces, dyskusje, członkostwa).

**Problem, który rozwiązujemy:** twórca (np. YouTuber, Instagramer) chcący sprzedawać własne produkty cyfrowe musi dziś skleić 4-6 płatnych narzędzi (Circle/Kajabi/Teachable + MailerLite + Stripe + landing page builder), płacić 50-300 USD/mies. i oddać kontrolę nad swoim contentem i listą klientów zamkniętym platformom. Alternatywy open source (Moodle, LearnHouse, Discourse) pokrywają pojedyncze filary i nie są zaprojektowane pod sprzedaż.

**Nasza odpowiedź:** model Fair Source / source-available — darmowy self-host z pełnymi funkcjami korowymi + bardzo tania wersja hostowana (1-5 USD/mies.), w której hostujemy wyłącznie aplikację, bazę danych i autoryzację, a **cały ciężki content (wideo, pliki) pozostaje własnością użytkownika** na jego zewnętrznych usługach (S3, YouTube, Vimeo, Bunny).

**Trzy wartości produktu (w tej kolejności): niezawodność, uniwersalność, cena.**

**Pozycjonowanie — cena jest hakiem, BYO jest umożliwiaczem:** nie sprzedajemy ideologii „own your data" (grupa, którą to obchodzi, jest za mała). Sprzedajemy cenę, przy której nikt nie rezygnuje z platformy, gdy sprzedaż siada. BYO storage nie jest głównym argumentem sprzedażowym — jest tym, co czyni niską cenę fizycznie możliwą (nie da się hostować wideo w tej cenie). Ścieżka użytkownika: przychodzi po cenę → odkrywa, że wideo wkleja się linkiem z YouTube → dla większości to w zupełności wystarcza.

**Spoiwo czterech filarów: „Klient 360" — jeden overview.** Gigantyczną wartością integracji filarów w jednym narzędziu jest jeden widok klienta: na jednej karcie członka twórca widzi **wszystkie subskrypcje, wszystkie zakupy, całą komunikację e-mail, aktywność w kursach, aktywność w społeczności, a jeśli dostępne — także wizyty na stronie**. To NIE jest CRM: żadnych lejków sprzedażowych, pipeline'ów, lead scoringu (może kiedyś — na razie nie). Klient to pojedyncza osoba kupująca, a twórca ma rozumieć jej historię bez przełączania pięciu narzędzi. W przyszłości dochodzi integracja prostego czatu (zewnętrznego, nie pisanego przez nas), żeby dosłownie cała komunikacja z klientem była w jednym miejscu.

---

## 2. Zasady przewodnie (niepodważalne założenia)

Te zasady rozstrzygają spory projektowe w przyszłości. Każda funkcja musi być z nimi zgodna.

### Z-1: Content należy do użytkownika (BYO storage)
- Platforma **nigdy nie przechowuje ciężkich plików** (wideo, duże pliki do pobrania). Przechowujemy wyłącznie: metadane, strukturę kursów, treści tekstowe, dane użytkowników końcowych, dane sprzedażowe i konfigurację.
- Wideo i pliki żyją u zewnętrznych dostawców podpiętych przez użytkownika: S3-compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO), YouTube (unlisted), Vimeo, Bunny (Stream + Storage).
- **Ścieżka zerowego kosztu i zerowej wiedzy: wklejenie linku z YouTube.** To domyślna, najprostsza droga dla nietechnicznego twórcy — nie wymaga żadnej konfiguracji ani opłat. W UI i dokumentacji umieszczamy notę, że użycie YouTube jako hostingu lekcji musi być zgodne z regulaminem YouTube — odpowiedzialność prawna leży po stronie twórcy, bo content należy do niego.
- Konsekwencja biznesowa: koszt infrastruktury hostowanej wersji sprowadza się do bazy danych i compute — dzięki temu cena 1-5 USD/mies. jest realna. **BYO nie jest argumentem sprzedażowym, jest warunkiem ceny.**
- Konsekwencja dla użytkownika: **zero lock-inu** — pełny eksport danych (JSON/CSV) w każdej chwili; odejście z platformy nie oznacza utraty contentu.
- Przyszłość (nie MVP): opcjonalny płatny dodatek „hosting wideo bez konfiguracji" — uploader w panelu oparty o Bunny Stream, gdzie hosting formalnie i kosztowo należy do zewnętrznej firmy (transparentne przeniesienie kosztów), a my dostarczamy tylko wygodę. Nie łamie Z-1: to nadal nie nasza infrastruktura.

### Z-2: BYO również dla pieniędzy i e-maili
- Płatności: **klucze Stripe użytkownika** — pieniądze idą bezpośrednio na jego konto Stripe, platforma nie pośredniczy w przepływie pieniędzy (zero ryzyka regulacyjnego, zero prowizji od sprzedaży w wersji podstawowej).
- Wysyłka e-mail: własny dostawca użytkownika (SMTP / Amazon SES / Resend / Postmark).

### Z-3: Podpinanie integracji ma być „effortless"
- Każda integracja (storage, Stripe, e-mail) konfigurowana **przez panel**: kreator krok po kroku, walidacja kluczy na żywo, test end-to-end (np. testowy upload + odczyt), czytelne komunikaty błędów.
- Docelowy użytkownik hosted **nie jest techniczny** — instrukcje z zrzutami ekranu „skąd wziąć klucz" dla każdego dostawcy.

### Z-4: Fair Source, uczciwy podział
- **Self-host: darmowy, pełne funkcje korowe** (wszystkie 4 filary). Instalacja jednym `docker compose up`.
- **Hosted (tania baza + dodatki):** te same funkcje korowe; płacisz za wygodę — hosting, backupy, aktualizacje, autoryzację, brak devopsu.
- **Custom domena i white-label w hosted to płatne dodatki, nie funkcje korowe** — to branding/wygoda infrastrukturalna, więc nie łamie tej zasady. W self-hoście własna domena jest naturalna, a plakietka usuwalna — akceptujemy to; self-hosterzy są marketingiem przez GitHub, hosted monetyzuje wygodę.
- **Płatne funkcje zaawansowane (przyszłość, wyższy plan):** funkcje „firmowe", nie korowe — np. zespoły/uprawnienia wieloosobowe, zaawansowane automatyzacje, priorytetowy support. Nigdy nie przenosimy funkcji z core do płatnych.

### Z-5: Creator-first
- Główna persona to twórca contentu bez zaplecza technicznego. Każdy flow mierzony pytaniem: „czy YouTuber ogarnie to sam w godzinę?".

---

## 3. Grupy docelowe (persony)

| Persona | Opis | Wersja | Kluczowa potrzeba |
|---|---|---|---|
| **Twórca „wyceniony poza rynek"** (główna) | Twórca/edukator, którego nie stać na 89-500 USD/mies. u Circle/Kajabi — albo który rezygnuje z platformy, gdy sprzedaż siada | Hosted | Cena, przy której platformę trzyma się „na zawsze"; wideo wkleja z YouTube |
| **Twórca nietechniczny** | YouTuber/Instagramer (1k-100k followersów), chce sprzedać kurs/ebooka | Hosted | Od zera do sprzedaży w 1 dzień, bez devopsu |
| **Twórca techniczny** | Programista-twórca (jak autor: CodeRoad) | Self-host | Pełna kontrola, brak vendor lock-in |
| **Kursant / członek** | Klient twórcy — kupuje, uczy się, dyskutuje | — | Prosty zakup, wygodne odtwarzanie, jedno konto u danego twórcy |
| **Zespół twórcy** *(przyszłość)* | VA, moderator, montażysta | Płatny plan | Role i uprawnienia |

Persony „techniczne" i zorientowane na własność danych to mile widziany, ale **poboczny** segment — za mały, żeby na nim budować wzrost.

**Pierwszy realny tenant (dogfooding):** migracja kursu CodeRoad (kurs.coderoad.pl) — walidacja delivery, płatności i migracji danych z legacy stacku (szczegóły w prywatnych materiałach właściciela).

---

## 4. Model biznesowy i dystrybucji

Model dystrybucji: darmowy self-host (pełny core, Fair Source) + tania wersja hostowana (subdomena + plakietka „Powered by Together") z płatnymi dodatkami brandingowymi (custom domena, white-label) i przyszłym planem Pro z funkcjami „firmowymi". Szczegółowy cennik, kwoty i zasady cenowe są utrzymywane w prywatnych materiałach operacyjnych właściciela.

- Licencja: **FSL-1.1-ALv2** (Functional Source License) — kod jest dostępny na zasadach Fair Source, ale nie jest open source przed automatycznym przejściem danego wydania na Apache-2.0 po dwóch latach. Wcześniej licencja pozwala na self-hosting, ale zabrania oferowania konkurencyjnego hostingu.
- Monorepo publiczne na GitHub; wersja hosted = ten sam kod + zamknięty moduł billing/provisioning.

### Ograniczenia projektowe (constraints)

- **Zespół: jedna osoba + agenci AI.** Zero zatrudnień.
- Konsekwencje architektoniczne: nudna, sprawdzona technologia; minimum ruchomych części w infrastrukturze; wszystko co się da — managed services albo BYO po stronie użytkownika; automatyzacja testów i CI od pierwszego dnia (nie ma QA); zakres faz musi być realistyczny dla solo developera wspieranego przez AI.
- Konsekwencja produktowa: dyscyplina fazowania jest egzystencjalna (por. upadek Zenbership w researchu) — nie zaczynamy fazy N+1 przed działającą fazą N.

---

## 5. Cele

- Twórca nietechniczny przechodzi od rejestracji do opublikowanego, kupowalnego produktu w **< 1 dzień** (docelowo < 2 h).
- Twórca techniczny stawia self-host w **< 15 minut** (`docker compose up` + kreator startowy).
- Pełna parytetowość funkcji korowych self-host ↔ hosted (jeden kod).
- Kurs CodeRoad zmigrowany i działający na nowej platformie jako pierwszy tenant — **i jako poligon testowy wszystkich filarów przed publicznym startem** (patrz bramka w §6).
- 100% ciężkiego contentu poza naszą infrastrukturą (zero plików wideo w naszej bazie/storage).

---

## 6. Zakres — filary i fazy

⚠️ Przyjęto (do potwierdzenia): **rdzeń MVP = Delivery + Sprzedaż**, potem Społeczność, potem Marketing. Uzasadnienie: to najkrótsza ścieżka do produktu, którym twórca może zarabiać, i pokrywa się z potrzebą migracji CodeRoad.

### Faza 0 — Fundament
Multi-tenancy, auth, panel twórcy, system adapterów integracji (storage/e-mail/Stripe), self-host (docker compose), design system.

### Faza 1 — MVP: Delivery + Sprzedaż
Produkty (kurs / pliki / członkostwo), builder kursu, odtwarzanie wideo z BYO providerów, checkout Stripe, dostępy, strona produktu, prosty branding.

### Faza 2 — Społeczność
Spaces, posty, komentarze, reakcje, członkostwa powiązane z produktami, powiadomienia, moderacja.

### Faza 3 — Marketing
E-mail (broadcasty, sekwencje), tagi/segmenty, landing pages, kupony, proste automatyzacje („kupił X → tag Y → sekwencja Z").

### Faza 4 — Monetyzacja platformy i Pro
Billing wersji hosted, provisioning tenantów self-service, dodatki brandingowe (custom domena, white-label), funkcje Pro (zespoły, automatyzacje zaawansowane), program afiliacyjny dla produktów twórców.

Fazy 2-4 dostaną **osobne, szczegółowe PRD** przed rozpoczęciem prac. Ten dokument definiuje je kierunkowo.

### Bramka startu komercyjnego: dogfooding na CodeRoad

Publiczny start Together (sprzedaż wersji hosted, marketing platformy, przyjmowanie zewnętrznych twórców) następuje **dopiero po przetestowaniu marketingu, sprzedaży i delivery na CodeRoad jako żywym tenancie z realnymi kursantami**. Budujemy etapami (fazy jak wyżej), ale nie komercjalizujemy po fazie 1 — projekt w zakresie podstawowych funkcjonalności nie jest absurdalnie duży, więc stać nas na dowiezienie więcej przed startem zamiast sprzedawania niedojrzałego produktu. CodeRoad daje możliwość przetestowania wszystkiego end-to-end bez ryzyka reputacyjnego u cudzych klientów.

---

## 7. User stories

Stories fazy 0 i 1 są rozpisane do poziomu implementowalnego. Fazy 2-4 — poziom epików.

### Epik A: Fundament — multi-tenancy i auth (Faza 0)

#### US-001: Szkielet aplikacji multi-tenant
**Opis:** Jako operator platformy chcę, żeby jedna instancja obsługiwała wielu twórców (tenantów) z pełną izolacją danych.

**Kryteria akceptacji:**
- [ ] Model `Tenant` (nazwa, slug, subdomena, status, plan)
- [ ] Każda kolekcja danych tenanta ma `tenantId`; access control wymusza filtrowanie po tenancie na poziomie frameworka (nie w handlerach)
- [x] Routing po subdomenie: `{slug}.platforma.dev` → właściwy tenant; nieznana subdomena → 404
- [ ] W trybie self-host działa pojedynczy tenant bez konfiguracji subdomen
- [x] Test automatyczny: użytkownik tenanta A nie może odczytać żadnego rekordu tenanta B
- [x] Typecheck/lint przechodzi

#### US-002: Konta i role w obrębie tenanta
**Opis:** Jako twórca chcę mieć konto administracyjne, a moi klienci konta członkowskie, żeby rozdzielić panel zarządzania od widoku kursanta.

**Kryteria akceptacji:**
- [x] Role: `owner` (twórca), `member` (kursant/członek); architektura ról rozszerzalna (przyszłe: `staff`, `moderator`)
- [x] Rejestracja/logowanie e-mail + hasło oraz magic link
- [x] Reset hasła przez e-mail
- [x] Relacja członka jest per-tenant (rekord `members`; ten sam e-mail może być klientem dwóch twórców niezależnie) przy jednym globalnym koncie logowania (ADR-0002 agentproofarch)
- [x] Typecheck/lint przechodzi

#### US-003: Panel twórcy — szkielet
**Opis:** Jako twórca chcę mieć panel administracyjny z nawigacją po sekcjach (Produkty, Sprzedaż, Członkowie, Integracje, Ustawienia), żeby zarządzać wszystkim z jednego miejsca.

**Kryteria akceptacji:**
- [x] Layout panelu z nawigacją; sekcje puste mają stan „coming soon"
- [ ] Dostęp tylko dla roli `owner`
- [x] Responsywny (twórcy pracują też z telefonu)
- [x] Typecheck/lint przechodzi
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-004: Self-host jednym poleceniem
**Opis:** Jako twórca techniczny chcę postawić platformę przez `docker compose up`, żeby nie tracić czasu na devops.

**Kryteria akceptacji:**
- [ ] `docker-compose.yml` (app + Postgres) w repo; start bez edycji plików poza `.env`
- [x] Kreator pierwszego uruchomienia: utworzenie konta ownera i tenanta przez przeglądarkę
- [ ] README z instrukcją self-host (< 1 strona)
- [ ] Zmierzony czas od `git clone` do działającego panelu < 15 min

### Epik B: System integracji BYO (Faza 0)

#### US-010: Rama adapterów integracji
**Opis:** Jako deweloper platformy chcę wspólny interfejs dla integracji (storage, e-mail, płatności), żeby dodawanie kolejnych dostawców było tanie.

**Kryteria akceptacji:**
- [ ] Interfejsy: `StorageProvider` (upload przez presigned URL, signed GET, delete, healthcheck), `EmailProvider` (send, healthcheck), `PaymentProvider` (checkout session, webhook verify)
- [x] Sekrety integracji szyfrowane at rest (nie plaintext w DB)
- [ ] Każdy adapter ma metodę `test()` zwracającą sukces/diagnozę błędu — używaną przez panel
- [x] Typecheck/lint przechodzi

#### US-011: Kreator podpinania storage S3-compatible
**Opis:** Jako twórca chcę podpiąć własny bucket (AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO) przez panel, żeby moje pliki były u mnie.

**Kryteria akceptacji:**
- [ ] Kreator: wybór dostawcy → pola (endpoint, region, bucket, klucze) → test na żywo (upload + odczyt + delete pliku testowego) → zapis
- [ ] Błędne dane → czytelny komunikat co poprawić (nie surowy błąd SDK)
- [ ] Instrukcja per dostawca „skąd wziąć klucze" (link/tooltip)
- [ ] Weryfikacja w przeglądarce (dev-browser skill)

#### US-012: Podpinanie wideo — YouTube / Vimeo / Bunny Stream
**Opis:** Jako twórca chcę wskazać, gdzie trzymam wideo, żeby lekcje odtwarzały się z mojego konta.

**Kryteria akceptacji:**
- [ ] YouTube (unlisted) i Vimeo: wklejenie URL wideo w lekcji, walidacja i podgląd
- [x] Bunny Stream: podpięcie API key + library przez kreator (jak US-011), listowanie wideo z biblioteki i osadzanie z tokenem (podpisane URL-e)
- [ ] Dokumentacja ograniczeń prywatności per dostawca (np. YouTube unlisted ≠ realna ochrona — jasno komunikowane twórcy)
- [ ] Weryfikacja w przeglądarce (dev-browser skill)

#### US-013: Podpinanie Stripe
**Opis:** Jako twórca chcę podpiąć własne konto Stripe przez panel, żeby pieniądze trafiały bezpośrednio do mnie.

**Kryteria akceptacji:**
- [ ] Kreator: klucze API (restricted key — instrukcja jakie uprawnienia) + automatyczna rejestracja webhooka
- [x] Test na żywo: utworzenie i anulowanie testowej sesji checkout w trybie test mode
- [ ] Obsługa trybu test/live z wyraźnym oznaczeniem w panelu
- [ ] Weryfikacja w przeglądarce (dev-browser skill)

#### US-014: Podpinanie e-mail transakcyjnego
**Opis:** Jako twórca chcę podpiąć własną wysyłkę (SMTP / SES / Resend), żeby e-maile (magic linki, potwierdzenia zakupu) szły z mojej domeny.

**Kryteria akceptacji:**
- [ ] Kreator jak w US-011, test = wysyłka e-maila testowego na adres twórcy
- [x] Wersja hosted: fallback na współdzieloną wysyłkę platformy (limitowaną), żeby onboarding nie blokował się na DNS
- [ ] Weryfikacja w przeglądarce (dev-browser skill)

### Epik C: Produkty i delivery (Faza 1)

#### US-020: Tworzenie produktu
**Opis:** Jako twórca chcę utworzyć produkt (kurs / paczka plików / członkostwo), nadać mu cenę i opis, żeby mieć co sprzedawać.

**Kryteria akceptacji:**
- [ ] Typy produktu: `course`, `digital_download`, `membership` (cyklicznie płatne)
- [ ] Pola: nazwa, slug, opis (rich text), okładka, cena (jednorazowa lub cykliczna), waluta, status (draft/published)
- [x] Lista produktów w panelu z filtrowaniem po statusie
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-021: Builder kursu
**Opis:** Jako twórca chcę zbudować strukturę kursu (moduły → lekcje) z treścią mieszaną (wideo + tekst + załączniki), żeby odwzorować swój program.

**Kryteria akceptacji:**
- [ ] Moduły i lekcje z drag & drop kolejnością
- [ ] Lekcja: tytuł, wideo (z podpiętego providera — US-012), treść rich text, załączniki (z S3 twórcy — US-011)
- [ ] Lekcje darmowe (preview) oznaczane flagą — dostępne bez zakupu
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-022: Widok kursanta — odtwarzanie kursu
**Opis:** Jako kursant chcę wygodnie przechodzić kurs (odtwarzacz, nawigacja po lekcjach, „oznacz jako ukończone"), żeby śledzić swój postęp.

**Kryteria akceptacji:**
- [x] Spis treści z paskiem postępu; stan ukończenia per lekcja zapisywany na koncie
- [x] Odtwarzanie wideo z każdego wspieranego providera w jednym, spójnym playerze/embedzie
- [ ] Załączniki pobierane przez podpisane URL-e z S3 twórcy (linki wygasające, niepubliczne)
- [x] Dostęp tylko dla członków z uprawnieniem do produktu (weryfikacja server-side)
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-023: Delivery paczki plików (digital download)
**Opis:** Jako kursant chcę po zakupie ebooka/paczki pobrać pliki, żeby korzystać z zakupu.

**Kryteria akceptacji:**
- [ ] Strona „moje produkty" z listą zakupów i przyciskami pobrania
- [ ] Pobieranie przez podpisane, wygasające URL-e; bez uprawnień → 403
- [ ] Weryfikacja w przeglądarce (dev-browser skill)

### Epik D: Sprzedaż (Faza 1)

#### US-030: Publiczna powierzchnia sprzedażowa (headless API + embeddy + checkout links)
**Opis:** Jako twórca chcę udostępniać ofertę na własnej stronie (Astro/Next/Webflow/czysty HTML) przez publiczne API i gotowe widgety oraz linkować bezpośrednio do checkoutu, żeby sprzedawać bez żadnej strony hostowanej przez platformę ([ADR-0001 agentproofarch](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md)).

**Kryteria akceptacji:**
- [x] Publiczne read-only JSON API oferty tenanta (produkty published, ceny): nieuwierzytelnione GET, otwarty CORS, nagłówki cache z wersją treści tenanta; produkty draft niewidoczne
- [x] Shareable checkout URL na domenie tenanta (kompletny flow zakupu renderowany przez platformę, model Stripe Payment Links) — twórca z zerową infrastrukturą wciąż może sprzedawać
- [ ] Widgety embed (`/embed/*`: script loader + iframe, postMessage auto-resize) — post-MVP
- [x] SEO/OG to zadanie strony własnej twórcy — platforma nie hostuje stron marketingowych i nie buduje machinerii SEO
- [x] Weryfikacja: curl publicznego API z innego originu (CORS + cache) oraz przeklikanie checkoutu w przeglądarce (dev-browser skill)

#### US-031: Checkout przez Stripe
**Opis:** Jako kupujący chcę zapłacić kartą/BLIK-iem przez Stripe Checkout, żeby natychmiast dostać dostęp.

**Kryteria akceptacji:**
- [x] CTA → Stripe Checkout Session na koncie Stripe twórcy (jednorazowe i subskrypcyjne ceny)
- [x] Webhook `checkout.session.completed` → utworzenie/znalezienie konta członka + nadanie dostępu do produktu + e-mail powitalny z magic linkiem
- [x] Idempotencja webhooków (retry Stripe nie duplikuje dostępów)
- [ ] Anulowanie subskrypcji Stripe → odebranie dostępu do membershipu (z okresem wypowiedzenia do końca opłaconego okresu)
- [x] Testy automatyczne flow webhooków
- [ ] Weryfikacja w przeglądarce pełnego flow w trybie test mode (dev-browser skill)

#### US-032: Panel sprzedaży i członków
**Opis:** Jako twórca chcę widzieć zamówienia i członków oraz ręcznie nadawać/odbierać dostępy, żeby zarządzać sprzedażą i obsługiwać przypadki brzegowe (zwroty, dostęp gratisowy).

**Kryteria akceptacji:**
- [x] Lista zamówień (kto, co, kiedy, kwota, status) i lista członków z ich dostępami
- [x] Ręczne nadanie/odebranie dostępu do produktu (np. gratis dla współpracownika, zwrot)
- [x] Eksport członków i zamówień do CSV
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-034: Widok członka 360 („jeden overview")
**Opis:** Jako twórca chcę na jednej karcie członka widzieć całą jego historię (zakupy, subskrypcje, dostępy, postęp w kursach), żeby rozumieć klienta bez przełączania narzędzi.

**Kryteria akceptacji:**
- [ ] Karta członka: dane konta, lista zakupów, aktywne subskrypcje ze statusem ze Stripe, nadane dostępy, postęp w kursach z datą ostatniej aktywności
- [ ] Oś czasu (timeline) zdarzeń zasilana **zdarzeniami domenowymi** — wspólny model zdarzenia pozwala w kolejnych fazach dodawać nowe typy (faza 2: aktywność w społeczności; faza 3: wysłane e-maile; później: wizyty na stronie, komunikacja z czatu) bez przebudowy
- [ ] Wejście na kartę członka z listy członków i z listy zamówień (1 klik)
- [x] Typecheck/lint przechodzi
- [x] Weryfikacja w przeglądarce (dev-browser skill)

#### US-033: Branding tenanta
**Opis:** Jako twórca chcę ustawić logo, kolory i nazwę, żeby platforma wyglądała jak moja marka.

**Kryteria akceptacji:**
- [ ] Ustawienia: logo, kolor wiodący, nazwa, opis, linki social
- [x] Branding widoczny na stronach publicznych, w widoku kursanta i w e-mailach transakcyjnych
- [x] Weryfikacja w przeglądarce (dev-browser skill)

### Epiki faz 2-4 (kierunkowo — osobne PRD przed realizacją)

- **US-E20 Społeczność:** spaces (otwarte / dla członków / powiązane z produktem), posty z rich text, komentarze wątkowane, reakcje, wzmianki, powiadomienia (in-app + e-mail digest), narzędzia moderacji (usuwanie, ban), profil członka. Zdarzenia społeczności (posty, komentarze) zasilają oś czasu członka (US-034).
- **US-E30 Marketing:** tagi i segmenty członków, broadcasty e-mail, sekwencje (drip), formularze zapisu / lead magnety, landing pages z prostych bloków, kupony rabatowe (integracja ze Stripe Coupons), automatyzacje „trigger → akcja". Każdy wysłany e-mail (transakcyjny i marketingowy) zapisuje się w osi czasu członka (US-034).
- **US-E40 Platforma hosted:** rejestracja self-service, provisioning tenantów, billing platformy (Stripe), limity planów, custom domeny (CNAME + auto-TLS), backupy i eksport danych tenanta, panel operatora.

---

## 8. Wymagania funkcjonalne

### Rdzeń i multi-tenancy
- **FR-1:** System musi obsługiwać wielu tenantów w jednej instancji z izolacją danych wymuszaną na poziomie warstwy dostępu do danych (każde zapytanie automatycznie filtrowane po `tenantId`).
- **FR-2:** System musi działać w trybie single-tenant (self-host) bez żadnej konfiguracji multi-tenancy.
- **FR-3:** Własność relacji z członkiem musi być izolowana per tenant przy wspólnym uwierzytelnieniu ([ADR-0002 agentproofarch](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md)): globalne konto trzyma wyłącznie logowanie (dopuszczalne konto bez hasła + magic link), a cała relacja — profil, tagi, zgody RODO, snapshot e-maila, dostępy — żyje w naszym rekordzie `members` per tenant. Ten sam e-mail może być klientem wielu twórców niezależnie; żadne API nie pozwala członkowi wylistować tenantów, do których należy.
- **FR-4:** System musi oferować pełny eksport danych tenanta (członkowie, zamówienia, struktura kursów, posty) do otwartych formatów (JSON/CSV).

### Integracje BYO
- **FR-10:** System musi przechowywać sekrety integracji zaszyfrowane at rest.
- **FR-11:** Każda integracja musi być konfigurowalna wyłącznie przez panel (kreator z walidacją i testem na żywo); edycja plików konfiguracyjnych nie może być wymagana.
- **FR-12:** Storage plików: system musi wspierać dowolny endpoint S3-compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
- **FR-13:** Wideo: system musi wspierać osadzanie z YouTube (unlisted), Vimeo oraz Bunny Stream (z podpisanymi URL-ami); architektura musi pozwalać dodać kolejnego providera bez zmian w modelu lekcji.
- **FR-14:** Upload plików twórcy musi iść bezpośrednio do jego storage (presigned URL), nie przez nasz serwer.
- **FR-15:** Pliki dla członków muszą być serwowane przez podpisane, wygasające URL-e po server-side weryfikacji uprawnień.
- **FR-16:** E-mail: system musi wspierać SMTP, Amazon SES i Resend jako providerów wysyłki.

### Produkty i delivery
- **FR-20:** System musi wspierać typy produktów: kurs, paczka plików (digital download), członkostwo (płatność cykliczna).
- **FR-21:** Kurs musi mieć strukturę moduły → lekcje; lekcja może zawierać wideo, treść rich text i załączniki jednocześnie.
- **FR-22:** Lekcje mogą być oznaczone jako darmowe preview, dostępne bez zakupu.
- **FR-23:** System musi zapisywać postęp kursanta (ukończone lekcje) i pokazywać pasek postępu.
- **FR-24:** Dostęp do treści produktu musi być weryfikowany server-side przy każdym żądaniu (nie tylko ukrycie w UI).

### Sprzedaż
- **FR-30:** Płatności wyłącznie przez konto Stripe twórcy (jego klucze API); platforma nie przetwarza środków.
- **FR-31:** Zakup musi automatycznie: utworzyć konto członka (jeśli nie istnieje), nadać dostęp, wysłać e-mail z linkiem logowania.
- **FR-32:** Obsługa webhooków Stripe musi być idempotentna i pokryta testami.
- **FR-33:** Wygaśnięcie/anulowanie subskrypcji musi odbierać dostęp do produktów typu membership z końcem opłaconego okresu.
- **FR-34:** Twórca musi móc ręcznie nadać i odebrać dostęp dowolnemu członkowi.
- **FR-35:** Platforma nie hostuje publicznych stron produktu (ADR-0001 agentproofarch). Publiczną powierzchnię sprzedażową tworzą: publiczne read-only JSON API oferty tenanta (nieuwierzytelnione GET, otwarty CORS, cache z wersją treści tenanta), shareable checkout URL na domenie tenanta (pełny flow zakupu bez strony po stronie twórcy) oraz — post-MVP — widgety embed (`/embed/*`). SEO stron sprzedażowych należy do własnej strony twórcy.
- **FR-36:** System musi udostępniać widok 360 członka: karta z zakupami, subskrypcjami, dostępami i postępem kursów oraz oś czasu zdarzeń domenowych. Model zdarzenia musi być rozszerzalny o kolejne źródła bez przebudowy: aktywność w społeczności (faza 2), wysłane e-maile (faza 3), wizyty na stronie (jeśli dostępne, później), komunikacja z zewnętrznego czatu (integracja, później). To NIE jest CRM — bez lejków, pipeline'ów i lead scoringu.

### Społeczność (Faza 2 — kierunkowo)
- **FR-40:** Spaces z widocznością: publiczna / dla wszystkich członków / dla posiadaczy wskazanych produktów.
- **FR-41:** Posty, komentarze wątkowane, reakcje; powiadomienia in-app i e-mail.
- **FR-42:** Narzędzia moderacji: usuwanie treści, blokowanie członków.

### Marketing (Faza 3 — kierunkowo)
- **FR-50:** Tagowanie i segmentacja członków (ręczna + automatyczna po zdarzeniach zakupu).
- **FR-51:** Broadcasty i sekwencje e-mail przez podpiętego providera twórcy, z obsługą wypisu (unsubscribe) zgodną z RODO.
- **FR-52:** Kupony rabatowe zsynchronizowane ze Stripe.
- **FR-53:** Landing pages / formularze zapisu budowane z gotowych bloków w panelu.
- **FR-54:** Automatyzacje: deklaratywne reguły „trigger (zakup, zapis, tag) → akcja (tag, e-mail, dostęp)".
- **FR-55:** Każdy e-mail wysłany do członka (transakcyjny i marketingowy) musi być zapisany jako zdarzenie w osi czasu członka (FR-36).

### Wersja hosted (Faza 4 — kierunkowo)
- **FR-60:** Rejestracja i provisioning tenanta self-service (bez udziału operatora).
- **FR-61:** Billing platformy przez Stripe (nasz), niezależny od Stripe'ów twórców.
- **FR-62:** Custom domena tenanta (CNAME + automatyczny TLS) — jako płatny dodatek do planu bazowego (por. §4); plan bazowy ma subdomenę i plakietkę „Powered by Together".
- **FR-63:** Automatyczne backupy DB i samoobsługowy eksport/usunięcie tenanta (RODO).

---

## 9. Non-goals (poza zakresem)

**Trwale poza zakresem (sprzeczne z zasadami Z-1/Z-2):**
- Własny hosting i transkodowanie wideo (nigdy — to BYO; dopuszczalny jedynie przyszły uploader-dodatek na infrastrukturze Bunny, patrz §4).
- Przetwarzanie płatności jako pośrednik (merchant of record) — pieniądze zawsze idą przez Stripe twórcy.
- Marketplace/katalog kursów łączący twórców (każdy tenant to osobny świat).
- **Cokolwiek związanego z ekosystemem WordPress** (wtyczki, integracje, wersja na WP) — to inna liga i inna kategoria produktu; nie konkurujemy tam i nie budujemy tam.

**Poza zakresem faz 0-3 (możliwe później):**
- Live streaming, wideo-czaty, eventy na żywo.
- Czat real-time (DM, kanały) — społeczność startuje jako async (posty/komentarze).
- Aplikacje mobilne (web responsywny musi wystarczyć).
- Gamifikacja (punkty, odznaki, leaderboardy).
- Certyfikaty ukończenia, quizy/egzaminy.
- Fakturowanie/VAT (twórca rozwiązuje po stronie Stripe Tax / zewnętrznej fakturowni) — do rewizji dla rynku PL.
- Program afiliacyjny.
- Wielojęzyczność UI poza PL + EN.
- Integracje z platformami zewnętrznymi typu Zapier.
- **CRM z lejkami sprzedażowymi, pipeline'ami, lead scoringiem** — klient to pojedyncza osoba kupująca, nie „lead w lejku"; widok Klient 360 (FR-36) to overview, nie CRM. Może kiedyś — na razie świadomie nie.
- **Własny czat** — nigdy nie piszemy własnego; docelowo (po fazach 0-3) integracja zewnętrznego czatu (np. Chatwoot/Crisp) wpięta w oś czasu członka, żeby cała komunikacja z klientem była w jednym miejscu.

---

## 10. Założenia techniczne

**Architektura normatywna żyje w osobnym repo: [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch)** — „agent-first, strictly layered full-stack TypeScript foundation for multi-tenant SaaS" autorstwa założyciela (aktywnie rozwijana; stan 2026-07-03: działający walking skeleton — auth, organizacje/tenanty, rozwiązywanie tenanta po domenie, custom domeny, zasób demo przez wszystkie warstwy, CLI i SPA). Ten dokument **nie duplikuje architektury** — pełna specyfikacja żyje w dokumentacji tamtego repo (katalog `docs/`: opisy architektury i ADR-y). Poniżej tylko: decyzje, konsekwencje dla Together i punkty tarcia.

**Decyzje przejęte z agentproofarch (zastępują wcześniejsze założenia tego PRD, w tym rekomendację Next.js z 2026-07-02):**
- **Vite + React SPA (bez SSR, bez Next.js) + Hono** jako warstwa HTTP — ten sam kod działa na Node i Vercel Functions (entrypointy ~5 linii); TanStack Router/Query; jeden typowany klient (`core/client`) współdzielony przez web i CLI.
- **Drizzle ORM** z fabryką sterowników `node-postgres | neon-http` (rozstrzyga otwarty detal „Prisma vs Drizzle" — Drizzle).
- **Better Auth — wyłącznie tożsamość, bez pluginu organizacji** (rozstrzyga „Better Auth vs Auth.js"; ADR-0002: tenants/tenant_admins/members to tabele fundamentu, provider dostarcza tylko logowanie i metody auth — magic link, social, passkeys, 2FA — za portami `AuthPort`/`AuthClientPort`).
- **MUI** jako warstwa UI (zamiast wcześniej zakładanego Tailwind + shadcn/ui).
- **Postgres**: Neon na Vercelu (`neon-http`), kontener `postgres:16` w self-host.
- **Warstwy wymuszane maszynowo:** `core/domain → contract / server (use-case'y + porty) / client` → `adapters` → `apps` (composition root — jedyne miejsce instancjonowania adapterów). `eslint-plugin-boundaries` + `dependency-cruiser` + `knip`; `any` i asercje `as` (poza `as const`) to błędy lintu; `Result<T, AppError>` z zamkniętą taksonomią błędów i jednym envelope HTTP. Nikt (człowiek ani agent) nie złamie architektury bez czerwonego `npm run check`.
- **CLI jako pętla weryfikacyjna agenta** — każda funkcja platformy wywoływalna z terminala z `--json` (jeden dokument JSON na stdout) i deterministycznymi kodami wyjścia mapowanymi z taksonomii błędów. To bezpośrednia realizacja constraintu „solo + AI": agent implementuje i weryfikuje funkcje bez przeglądarki.
- **Deploy z jednego commita, różni się tylko env:** Vercel (statyczne SPA + funkcja Hono + Neon) lub Docker self-host (`docker compose up`: app + Postgres + **Caddy z on-demand TLS** — dzięki czemu custom domeny działają także w self-hoście, nie tylko na Vercelu). Stringi „vercel"/„neon" dozwolone wyłącznie w `adapters/` — wymuszone lintem.
- **Rozwiązywanie tenanta per request:** custom domena (`tenant_domains`) → subdomena `APP_BASE_DOMAIN` → nagłówek `X-Tenant` (CLI); członkostwo weryfikowane zawsze; każdy tenant-scoped use-case dostaje `ctx.identity`, każde repozytorium wymaga `tenantId`.
- **Jedno `package.json`, bez workspaces**; `npm run check` (typecheck + lint + granice + graf zależności + dead code + testy) jako pojedyncza bramka.
- Vercel jako hosting hosted — potwierdzony wcześniejszą weryfikacją (2026-07-02): custom domeny unlimited na Pro, auto-SSL, wildcard, Domains API.

**Co pozostaje specyficzne dla Together (nie ma tego w agentproofarch):**
- Adaptery BYO (`StorageProvider`/`EmailProvider`/`PaymentProvider` z US-010) — naturalnie wpisują się we wzorzec portów (precedens: `DomainPort` z implementacjami vercel/caddy/noop); każdy nasz port ma realne ≥2 implementacje, więc jest zgodny z tamtejszą zasadą „no speculative ports".
- Sekrety integracji szyfrowane at rest; zdarzenia domenowe pod Klienta 360 (FR-36); migracja CodeRoad (legacy stack → nowa struktura; szczegóły w prywatnych materiałach właściciela); testy krytyczne: izolacja tenantów + webhooki Stripe.
- Repo produktowe: `coderoadpl/togethercommunity-app` (publiczne, FSL-1.1-ALv2 — patrz LICENSE.md); fundament architektoniczny: `coderoadpl/agentproofarch` (będzie jeszcze korygowany — śledzić zmiany).

**Punkty tarcia agentproofarch ↔ Together — rozstrzygnięte ADR-ami (2026-07-11):**
1. **Publiczna powierzchnia sprzedażowa** — rozstrzygnięte przez [ADR-0001](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md): platforma nie hostuje żadnych stron marketingowych/produktowych (SEO robi strona własna twórcy); dostarcza headless public JSON API (open CORS, cache z wersją treści), shareable checkout links na domenie tenanta i — post-MVP — widgety embed `/embed/*`. FR-35/US-030 przepisane zgodnie z tym.
2. **Model tożsamości członków** — rozstrzygnięte przez [ADR-0002](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md): globalne konto = wyłącznie uwierzytelnianie; własność relacji per tenant w naszych tabelach (`tenants`/`tenant_admins`/`members` ze snapshotem e-maila); żadnych funkcji organizacji po stronie providera; konta bez hasła z webhooka płatności przez idempotentne `ensureMember` + magic link na domenie tenanta. FR-3 przeformułowane zgodnie z tym.

---

## 11. Mierniki sukcesu

| Miernik | Cel |
|---|---|
| Czas: rejestracja → opublikowany, kupowalny produkt (twórca nietechniczny, hosted) | < 2 h |
| Czas: `git clone` → działający panel (self-host) | < 15 min |
| Ciężkie pliki w naszej infrastrukturze | 0 |
| Pokrycie testami izolacji tenantów i webhooków | 100% ścieżek krytycznych |
| Bramka startu komercyjnego | Marketing, sprzedaż i delivery przetestowane end-to-end na CodeRoad z realnymi kursantami |
| Walidacja po publicznym starcie | ≥ 1 zewnętrzny twórca sprzedaje produkt |

---

## 12. Otwarte pytania

**Decyzje przyjęte bez potwierdzenia użytkownika (⚠️ — potwierdź lub zmień):**
1. **Rdzeń MVP = Delivery + Sprzedaż** (nie społeczność-first jak Circle). Alternatywa: społeczność jako rdzeń zmienia kolejność faz 1↔2.
2. **Zakres marketingu** przyjęty w pełni (e-mail + landing pages + automatyzacje + kupony), ale cały przesunięty do fazy 3.
3. ~~Stack~~ → **rozstrzygnięte (2026-07-03): architektura normatywna = [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch)** — Vite+React SPA + Hono + Drizzle + Better Auth + MUI + Postgres (Neon/Docker), warstwy wymuszane lintem, CLI jako pętla weryfikacyjna agenta, deploy Vercel/Docker z jednego commita. Szczegóły i punkty tarcia w §10. (Wcześniejsze iteracje: Payload → Next.js — obie zastąpione.)
4. **Hosted = multi-tenant** (wspólna instancja). Instancja-per-klient odrzucona kosztowo przy cenie 1-5 USD.

**Pytania wymagające decyzji przed odpowiednimi fazami:**
5. ~~Licencja~~ → **rozstrzygnięte: FSL-1.1-ALv2 (Fair Source / source-available), z automatycznym przejściem każdego wydania na Apache-2.0 po dwóch latach.**
6. ~~Nazwa produktu~~ → **Together** (zdecydowane). Domena wciąż otwarta — together.* zajęte; warianty domen do sprawdzenia (lista w prywatnych materiałach).
7. Cena hosted — **struktura rozstrzygnięta (2026-07-03): tania baza (subdomena + plakietka) + płatne dodatki: custom domena i white-label.** Dokładne kwoty i zasady cenowe są utrzymywane w prywatnych materiałach operacyjnych. Otwarty detal: czy dodać plan darmowy hosted (np. 1 produkt) jako lejek.
8. Rynek startowy: PL-first (UI po polsku, BLIK/P24 przez Stripe, integracja z fakturownią?) czy EN-first global? Wpływa na priorytet i18n i fakturowania.
9. Czy „membership" w fazie 1 obejmuje też płatny dostęp do społeczności (wymaga kawałka fazy 2), czy tylko do treści?
10. YouTube unlisted jako źródło wideo: akceptujemy słabą ochronę treści (link może wyciec) w zamian za zerowy koszt — czy komunikujemy i zostawiamy, czy rekomendujemy Bunny jako domyślne?
11. Strategia wobec istniejących rozwiązań OSS (LearnHouse): budować od zera czy najpierw zrobić przegląd, czy któreś nie nadaje się jako fundament/inspiracja?
    → **Częściowo odpowiedziane researchem (2026-07-02):** żaden projekt OSS nie pokrywa 4 filarów; rekomendacja: własna warstwa aplikacyjna, LearnHouse/CourseLit jako referencja architektury. Rozwiązania oparte o WordPress wykluczone decyzją założyciela. Warstwę e-mail budujemy sami na BYO providerach. Szczegółowy research konkurencji jest utrzymywany w prywatnych materiałach właściciela.
12. Konkurencja do obserwowania: lista obserwowanych konkurentów i ich oceny są utrzymywane w prywatnych materiałach research właściciela (okresowy monitoring, nie paniczna reakcja).
13. Fakturowanie/VAT-OSS: research pokazał kontr-trend Merchant-of-Record (Paddle, Stripe Managed Payments) — czy BYO Stripe uzupełnić wcześniej o Stripe Tax + integracje z polskimi fakturowniami (dziś w non-goals)?
14. **Tryb pauzy/hibernacji konta** (propozycja z researchu rundy 2): $0-1/mies., treści zachowane, sprzedaż wyłączona — bezpośrednia odpowiedź na ból „rezygnuję z platformy, gdy sprzedaż siada"; żaden konkurent tego nie ma. Czy dodać do wymagań wersji hosted (faza 4)?
15. **Minimalny e-mail broadcast wcześniej niż faza 3?** Research rundy 2: brak e-maila to skarga nr 1 na Skool i częsty powód drugiego abonamentu; rekomendacja agentów: prosty broadcast + 2-3 sztywne automatyzacje (welcome, nowa treść) już w fazie 1-2, builder automatyzacji nigdy/późno. Czy przesunąć?
16. ~~SEO publicznych stron sprzedażowych vs zakaz SSR w agentproofarch~~ → **rozstrzygnięte (2026-07-11): [ADR-0001 agentproofarch](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md)** — żadnych hostowanych stron ani SSR stron; headless public JSON API + shareable checkout links + embeddy post-MVP. FR-35/US-030 przepisane (por. §10 „punkty tarcia").
17. ~~Model tożsamości kursantów~~ → **rozstrzygnięte (2026-07-11): [ADR-0002 agentproofarch](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md)** — globalne konto (tylko auth, dopuszczalne bez hasła) + własność relacji per tenant (`members` ze snapshotem e-maila, zgody RODO per tenant, eksport per tenant, FR-21: brak enumeracji tenantów, `ensureMember` z webhooka, magic link per domena tenanta). FR-3 zaktualizowane.

---

## Powiązane konteksty

- **Architektura normatywna: [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch)** — fundament multi-tenant SaaS (warstwy, porty, CLI, deploy Vercel/Docker); szczegóły w §10
- Research konkurencji (OSS + SaaS + rynek PL): prywatne materiały właściciela
- **Poprzednia iteracja Together (VI 2025): archiwum poprzedniej iteracji w prywatnych materiałach właściciela** — project-description, prd (m.in. poziomy dostępu publiczne/płatne/ukryte, zarządzanie członkostwem przez API, denormalizacja postępu kursanta), tech-stack (Vite+React+tRPC+Express+Prisma — ciekawostka: agentproofarch to w dużej mierze dojrzalsza wersja tego samego kierunku)
- Obecna platforma legacy (pierwszy tenant): produkcja kurs.coderoad.pl (szczegóły stacku w prywatnych materiałach właściciela)
