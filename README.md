# Together

Platforma source-available dla twórców: sprzedaż produktów cyfrowych + marketing + delivery kursów + społeczność w jednym. Darmowy self-host, bardzo tania wersja hostowana (1-5 USD/mies.), content zawsze należy do użytkownika (BYO storage: S3 / YouTube / Vimeo / Bunny; BYO Stripe).

**Wartości produktu: niezawodność, uniwersalność, cena.**

## Status

Działający PoC jest zaimplementowany w katalogu `app/`. Obejmuje aplikację
webową, serwer API, CLI, migracje i dane demonstracyjne oraz automatyczne testy
i reguły architektury; dokumenty nadal opisują kierunek dalszego rozwoju.

## Dokumenty

| Plik | Zawartość |
|---|---|
| [`tasks/prd-together.md`](tasks/prd-together.md) | **Aktualny PRD** — założenia, zasady, fazy, user stories, wymagania |
| [`app/README.md`](app/README.md) | **Quickstart** — uruchomienie lokalnego demo, konta testowe, CLI |
| [`architecture.md`](architecture.md) | Architektura Together — granice systemu, warstwy, słownik i reguły |
| [`docs/ses-onboarding.md`](docs/ses-onboarding.md) | Konfiguracja SES, gotowe odpowiedzi do wniosku AWS i awaryjne opcje SMTP |
| [`SECURITY.md`](SECURITY.md) | Prywatne zgłaszanie podatności, zakres i aktualna polityka wsparcia |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Jak zgłaszać zmiany — przebieg kontrybucji, wymagane bramki i przegląd |
| [`CLA.md`](CLA.md) | Umowa licencyjna kontrybutora (CLA) podpisywana przy pierwszym PR |
| [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md) | Licencje wszystkich zależności i noty projektowe (fundament, sharp/libvips, schematy FA(3)) |
| [`FOUNDATION.md`](FOUNDATION.md) | Pochodzenie fundamentu z agentproofarch — commit forka i synchronizowane ścieżki |
| [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch) | **Architektura normatywna** (osobne repo) — warstwy, porty, CLI, deploy Vercel/Docker |

## Nazwa i domena

Nazwa: **Together** (zdecydowana). Domena zostanie ogłoszona przy starcie wersji hostowanej.

## Licencja

Together jest udostępniany jako Fair Source na licencji
[FSL-1.1-ALv2](LICENSE.md). Możesz go hostować samodzielnie, ale nie możesz
oferować konkurencyjnego hostingu. Każde wydanie automatycznie przechodzi na
Apache-2.0 po dwóch latach. Więcej informacji:
[fsl.software](https://fsl.software/) i [fair.io](https://fair.io/).
