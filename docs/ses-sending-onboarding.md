# Konfiguracja wysyłki e-mail / E-mail sending setup

## Wyjście z Amazon SES sandbox

Status sandbox jest osobny dla każdego regionu AWS. Najpierw zweryfikuj domenę
i DKIM w tym samym regionie, który zapisujesz w Together. Następnie:

1. Otwórz Amazon SES → **Account dashboard** → **Request production access**.
2. Wybierz typ **Marketing**, jeśli planujesz kampanie, albo **Transactional**,
   jeśli konto będzie obsługiwać tylko wiadomości wywołane działaniem użytkownika.
3. Podaj publiczny adres swojej strony i adresy kontaktowe.
4. Potwierdź, że wysyłasz tylko do osób, które o to poprosiły, oraz że obsługujesz
   odbicia i skargi.
5. Wyślij wniosek. Pierwsza odpowiedź AWS zwykle przychodzi w ciągu 24 godzin.

Oficjalna instrukcja: [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

### Odpowiedź do wklejenia w opisie przypadku użycia

Zastąp tekst w nawiasach danymi swojej organizacji:

> [NAZWA] uses Amazon SES for one-to-one transactional messages triggered by
> user actions (sign-in links, password resets, purchase and access
> notifications) and for marketing messages only where the recipient has an
> active, specific e-mail marketing consent. Marketing consent is optional and
> not preselected. Definitions and wording versions are stored with timestamped
> evidence; double opt-in can be required. Every marketing message includes an
> unsubscribe mechanism. Together checks consent and the tenant suppression
> list again immediately before sending. Permanent bounces and complaints are
> written to the suppression list; future sends to suppressed recipients are
> blocked. SES delivery, bounce, and complaint events are received through an
> authenticated SNS endpoint and retained in the tenant-scoped event history.
> We do not use purchased, rented, or scraped lists. Expected initial volume is
> [LICZBA] messages per day, growing to [LICZBA] per day.

Przed wysłaniem wniosku upewnij się, że w checkliście Together są gotowe:
tożsamość i DKIM, configuration set, test webhooka SNS oraz dane stopki.

## Bezpłatne opcje SMTP dla wiadomości transakcyjnych

SMTP w Together służy wyłącznie wiadomościom transakcyjnym. Panel zapisuje
przyjęcie wiadomości przez relay, ale bez późniejszej korelacji dostarczeń,
odbić i skarg. Kampanie marketingowe nigdy nie korzystają z SMTP.

### Osobisty Gmail

Włącz weryfikację dwuetapową, utwórz 16-znakowe hasło aplikacji i ustaw:

- host `smtp.gmail.com`;
- port `465` z włączonym TLS albo `587` z połączeniem STARTTLS;
- użytkownik: pełny adres Gmail;
- hasło: hasło aplikacji, nie hasło do konta.

Google wymaga weryfikacji dwuetapowej dla haseł aplikacji i samo wskazuje, że
nie są one zalecaną metodą integracji. Konto konsumenckie może zostać
zablokowane po około 500 wiadomościach lub odbiorcach dziennie; płatne konto
Workspace ma inne limity, zwykle do 2000 wiadomości dziennie przy zwykłej
wysyłce. To działa przy małej skali, ale nie jest zalecane ze względu na
dostarczalność i ryzyko czasowej blokady konta.

Źródła: [Google App Passwords](https://support.google.com/accounts/answer/185833),
[Gmail limits](https://support.google.com/mail/answer/22839),
[Workspace sending limits](https://support.google.com/a/answer/166852).

### Brevo lub Mailjet

- Brevo: bezpłatny plan obejmuje 300 wysyłek dziennie.
- Mailjet: bezpłatny plan obejmuje 6000 wysyłek miesięcznie, maksymalnie 200
  dziennie.

Oba udostępniają dane SMTP. Limity i warunki planów mogą się zmienić, dlatego
sprawdź je przed podłączeniem:
[Brevo Free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan),
[Mailjet Free plan](https://documentation.mailjet.com/hc/en-us/articles/8625025643803-Mailjet-Subscription-Management).

## English summary

Verify the SES domain and DKIM in the selected AWS Region, request production
access from the SES account dashboard, and use the ready-to-paste English
use-case statement above. Complete the Together checklist for the configuration
set, SNS round-trip, and footer. SMTP is a transactional-only fallback with
relay-acceptance tracking; marketing always requires the tenant's verified SES
identity.
