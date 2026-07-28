# Together

Platforma source-available dla twórców: sprzedaż produktów cyfrowych + marketing + delivery kursów + społeczność w jednym. Darmowy self-host, bardzo tania wersja hostowana (1-5 USD/mies.), content zawsze należy do użytkownika (BYO storage: S3 / YouTube / Vimeo / Bunny; BYO Stripe).

**Wartości produktu: niezawodność, uniwersalność, cena.**

## Status

Etap założeń projektowych (lipiec 2026). Brak kodu.

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

## Licencja

Together jest udostępniany jako Fair Source na licencji
[FSL-1.1-Apache-2.0](LICENSE.md). Możesz go hostować samodzielnie, ale nie możesz
oferować konkurencyjnego hostingu. Każde wydanie automatycznie przechodzi na
Apache-2.0 po dwóch latach. Więcej informacji:
[fsl.software](https://fsl.software/) i [fair.io](https://fair.io/).
