# Together

Open-source'owa platforma dla twórców: sprzedaż produktów cyfrowych + marketing + delivery kursów + społeczność w jednym. Darmowy self-host, bardzo tania wersja hostowana (1-5 USD/mies.), content zawsze należy do użytkownika (BYO storage: S3 / YouTube / Vimeo / Bunny; BYO Stripe).

**Wartości produktu: niezawodność, uniwersalność, cena.**

## Status

Działający PoC jest zaimplementowany w katalogu `app/`. Obejmuje aplikację
webową, serwer API, CLI, migracje i dane demonstracyjne oraz automatyczne testy
i reguły architektury; dokumenty nadal opisują kierunek dalszego rozwoju.

## Dokumenty

| Plik | Zawartość |
|---|---|
| `tasks/prd-together.md` | **Aktualny PRD** — założenia, zasady, fazy, user stories, wymagania |
| `docs/ses-onboarding.md` | Konfiguracja SES, gotowe odpowiedzi do wniosku AWS i awaryjne opcje SMTP |
| [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch) | **Architektura normatywna** (osobne repo) — warstwy, porty, CLI, deploy Vercel/Docker |
| `research/2026-07-02-alternatives.md` | Research konkurencji: open source, płatny SaaS, rynek PL, nisza BYO |
| `.ai/` | Poprzednia iteracja projektu (VI 2025) — archiwum, zastąpiona przez `tasks/prd-together.md` |

## Nazwa i domena

Nazwa: **Together** (zdecydowana). Domena: otwarta kwestia — `together.*` zajęte, do sprawdzenia warianty (`example-domain-a.*` itp.).
