# Declarative shop manifests

Use `shop plan`, `shop apply` and `shop drift` to manage workspaces and their
physical-product catalogues from one JSON file. They use the existing typed
`core/client` APIs: an owner session for workspace configuration, and optionally
the trusted operator route to provision missing workspaces. Only
`shop apply --integrations` configures integration credentials and registers
Stripe webhooks. The tool never uploads images, creates payments or purchases
shipments.

## Sign in first

Run commands from `app/`. Sign in with an account that owns every workspace whose
settings you intend to change. Catalogue operations use the existing staff
permissions; changing workspace settings requires the owner role.

For a disposable, locally seeded development environment:

```bash
pnpm --silent run cli --api-url http://localhost:48730 login --email kontakt+smoke-creator@togethercommunity.app --password demo-password-15
pnpm --silent run cli --api-url http://localhost:48730 --tenant acme whoami
```

For a hosted environment, use the existing `login` command with the real API
origin, account email and password in a protected automation environment. If the
account requires two-factor authentication, also supply `--totp-code` or an
unused `--backup-code`. The existing password flags use command arguments: do not
put real credentials into saved scripts, shell history, shared logs or a
manifest, and account for process-list visibility on the automation host.
Passkey-only or OAuth-only accounts need their existing supported sign-in path;
these commands do not add another authentication mechanism.

The CLI stores the session in the selected API origin's protected profile and
sends its Bearer token, plus the selected workspace header, on API requests. A
session is not a permanent automation key. Sign in again if it expires. Use the
same `--api-url` for login and the manifest commands; `--tenant` does not override
workspace slugs in the manifest.

Each shop's requests go to that workspace's subdomain on the same instance as
the selected API origin, and only for workspaces that origin has confirmed. The
command first reads the signed-in account's workspace list from the selected
origin (`GET /api/tenants`, without a workspace header). A manifest workspace is
confirmed when that list contains it, as a staff or member workspace, or when
this same `shop apply` run has just provisioned it through the selected origin's
operator route. An unconfirmed workspace never receives a request on a derived
host, so a slug that happens to equal a host label of a separate instance (for
example `preview` next to `preview.togethercommunity.app`) does not receive the
session token. `shop plan` and `shop drift` report an unconfirmed string-form
workspace as `provisioning: "missing"`, after which plan exits with the
validation code `2` and drift with `1`, and an unconfirmed provisioning entry as
`provisioning: "create"`; `shop apply` stops with a validation error that lists
the unconfirmed string-form workspaces before any write.

Confirmation alone does not prove that the derived host belongs to the same
instance: a provisioned slug, or a listed one, can equal a host label that a
separate instance serves. Before the first request that carries the session
token to a derived workspace host whose origin differs from the selected
origin, the command reads `GET /api/health` without credentials or a workspace
header from both the selected origin and that host, once per host in a run. It
sends the token only when both answer and report the same `version`, `sha`,
`commit`, `environment`, `production` and a non-null `databaseFingerprint` (a
hash of the database host name). When the host does not answer, answers
without a database fingerprint or reports any other value, the command stops
with a validation error naming the workspace and the operation, before any
authenticated request to that host. Two deployments of the same release that
share the same environment name and database host are indistinguishable to
this check.

The command does not guess the instance from the host name: before any
workspace request it asks the selected origin itself, with the profile's
session, for its identity (`GET /api/me`) and its workspace routing
(`GET /api/tenant/routing`, available to the workspace's owners and admins),
selecting the first confirmed manifest workspace with the workspace header. The routing answer names the workspace host the instance itself builds
from its configured base domain. The command accepts it only when that host is
`<workspace>.<base domain>` for the workspace the origin resolved, uses the
origin's port, and the selected origin is the base domain itself or a host one
label below it. Every workspace client then uses
`<scheme>://<workspace>.<base domain>[:<port>]` after the health comparison
above, and the operator client uses the selected origin, so the operator secret
goes only to the selected origin and the session token only to hosts that
report the selected origin's instance identity. For example `https://acme.staging.togethercommunity.app`
and `https://staging.togethercommunity.app` lead to
`https://studio.staging.togethercommunity.app` for the `studio` shop when that
instance's base domain is `staging.togethercommunity.app`, and
`https://togethercommunity.app` leads to `https://studio.togethercommunity.app`.
`http://localhost:48730` is kept as it is and selects each workspace with the
workspace header, without discovery requests.

Two origins do not report a base domain: the platform host (`start.<domain>`),
which resolves no workspace, and a bare base-domain origin when none of the
selected workspaces is confirmed yet. For those, pass `--base-domain <domain>` to
`shop plan`, `shop apply` or `shop drift`; the command then requires the selected
origin to be exactly `start.<domain>` or `<domain>`. When the origin does report
a base domain, `--base-domain` must match it. Any other origin is refused before
the first workspace request: a custom workspace domain, an IP address, or a host
whose reported workspace routing points elsewhere. An authentication or
permission failure of the discovery requests stops the command; it is never
replaced by a guess or by `--base-domain`. Before reading settings or catalogue
data, the command also checks `/api/me` on each workspace host and refuses a
workspace mismatch.

The tool supports multi-tenant instances only, where each workspace is served
on `<workspace>.<base domain>`. Do not use it against a single-tenant
self-hosted instance (one started without `APP_BASE_DOMAIN`). Such an instance
serves its workspace on its own application host, and no existing response
distinguishes it reliably from a multi-tenant instance: if that host's first
label happens to equal the workspace slug, the routing answer looks like a
workspace host and the derived base domain is a parent domain that the instance
does not serve, so another workspace, including one provisioned by the same run,
would be addressed on a host of that parent domain. The health comparison
above withholds the session token from such a host unless it reports the same
instance identity. In every other case the routing check above already refuses
such an origin.

Every request the tool sends refuses HTTP redirects: workspace requests carrying
the session token, integration configure requests carrying provider
credentials, and the operator provisioning request. A redirect answer stops the
command with `Shop operation refused a redirect: <operation>` instead of
resending the token, credential or body to the redirect target.

## Manifest version 1

Save the following complete example as `shop.json`. URLs and seller details are
fixture examples, not production setup. The example's VAT rates demonstrate the
format, not a tax recommendation.

```json
{
  "version": 1,
  "company": {
    "settings": {
      "invoiceSellerName": "Acme",
      "invoiceSellerAddress": "1 Example Street, 00-001 Example City, Poland",
      "invoiceVatMode": "rate",
      "invoiceVatRatePercent": 23,
      "supportEmail": "support@togethercommunity.app",
      "supportUrl": "https://togethercommunity.app/support",
      "termsUrl": "https://togethercommunity.app/terms",
      "privacyUrl": "https://togethercommunity.app/privacy",
      "autoIssueInvoices": false,
      "shippingRates": [
        {
          "id": "courier",
          "label": "Courier",
          "amountCents": 1500,
          "vatRatePercent": 23,
          "carrier": "other",
          "pickupPoint": "none",
          "active": true,
          "deliveryEstimateDays": { "min": 2, "max": 4 }
        }
      ]
    },
    "integrations": {
      "stripe": { "restrictedKeyEnv": "SHOP_STRIPE_TEST_KEY", "mode": "test" },
      "shipx": {
        "environment": "sandbox",
        "organizationIdEnv": "SHOP_SHIPX_ORGANIZATION_ID",
        "tokenEnv": "SHOP_SHIPX_TOKEN",
        "sender": {
          "name": "Acme",
          "company": "Acme",
          "email": "shipping@togethercommunity.app",
          "phone": "123456789",
          "street": "Example Street",
          "buildingNumber": "1",
          "city": "Example City",
          "postCode": "00-001"
        }
      },
      "parcelLocker": { "tokenEnv": "SHOP_GEOWIDGET_PUBLIC_TOKEN" }
    }
  },
  "shops": [
    {
      "workspace": "acme",
      "settings": {
        "name": "Acme Shop",
        "defaultLanguage": "en",
        "checkoutAppearance": {
          "displayName": "Acme Shop",
          "buttonColor": "#123456"
        }
      },
      "products": [
        {
          "slug": "paperback",
          "type": "physical",
          "title": "Paperback",
          "description": "A printed paperback delivered by courier.",
          "vatRate": 5,
          "deliveryMethod": "shipping",
          "parcelTemplate": "small",
          "coverUrl": "https://togethercommunity.app/assets/paperback.png",
          "variantGroup": "book",
          "variantLabel": "Paperback",
          "compliance": {
            "manufacturerName": "Acme",
            "manufacturerAddress": "1 Example Street, 00-001 Example City, Poland",
            "manufacturerEmail": "support@togethercommunity.app",
            "modelIdentifier": "paperback-v1",
            "safetyWarnings": "Keep packaging away from children."
          },
          "price": { "amountCents": 4900, "currency": "PLN" },
          "stock": { "onHand": 20 },
          "published": true
        }
      ]
    },
    {
      "workspace": {
        "slug": "studio",
        "provision": {
          "name": "Studio Shop",
          "ownerEmail": "owner@togethercommunity.app",
          "defaultLanguage": "en"
        }
      },
      "settings": {
        "name": "Studio Shop",
        "checkoutAppearance": { "displayName": "Studio Shop" }
      },
      "products": [
        {
          "slug": "hardback",
          "title": "Hardback",
          "description": "A printed hardback delivered by courier.",
          "vatRate": 5,
          "deliveryMethod": "shipping",
          "parcelTemplate": "medium",
          "price": { "amountCents": 6900, "currency": "PLN" },
          "stock": { "onHand": 15 },
          "published": true
        }
      ]
    },
    {
      "workspace": {
        "slug": "akademia",
        "provision": {
          "name": "Akademia Shop",
          "ownerEmail": "owner@togethercommunity.app"
        }
      },
      "settings": {
        "name": "Akademia Shop",
        "checkoutAppearance": { "displayName": "Akademia Shop" },
        "shippingRates": []
      },
      "integrations": { "shipx": null, "parcelLocker": null },
      "products": [
        {
          "slug": "printed-parts",
          "title": "Printed Parts",
          "description": "A set of printed parts for collection.",
          "deliveryMethod": "pickup",
          "price": { "amountCents": 2900, "currency": "PLN" },
          "stock": { "onHand": 10 },
          "published": true
        }
      ]
    }
  ]
}
```

### Company and workspace settings

The company level lives only in this manifest. The platform itself has no
organisation entity yet: applying company settings writes an independent copy
to each selected workspace. Changing the file has no effect until another apply.
There is no new company membership, permission, credential inheritance or server
resolver. Each shop still requires its own existing workspace permissions and
integration configuration.

`company` is optional and may contain `settings` and/or `integrations`. Each
shop has a required `workspace` (an existing slug string or the provisioning
object below), optional `settings` and `integrations`, and a required `products`
array (which may be empty). Workspace slugs and product slugs within one shop
must be unique, including across string and object workspace forms. A workspace
slug must not be one of the platform's reserved names (for example `start`,
`staging`, `status`, `docs` or `www`) in either form: a manifest that contains
one anywhere is refused before the first request, even when `--shop` selects
another workspace, because such a name addresses platform or environment hosts
rather than a workspace. A workspace slug also must not exceed 63 characters,
the length limit of a host label, because it becomes the first label of the
workspace host.

Effective settings merge company fields with shop fields. Shop values win,
nested objects merge by field, arrays replace in full, and an explicit `null`
clears a nullable setting rather than inheriting it. Omitted effective settings
are not written. Nested settings objects sent to the existing route, such as
`checkoutAppearance`, replace the corresponding stored object; specify all
fields you want to retain in that object.

Settings use the existing workspace route's field names and validation:

- Branding: `name`, `defaultLanguage`, `logoUrl`, `logoDarkUrl`, `faviconUrl`,
  `accentColor`, `accentLight`, `ogTitle`, `ogDescription`, `ogImageUrl`,
  `socialLinks`, `checkoutAppearance`.
- Support/legal: `supportEmail`, `supportUrl`, `termsUrl`, `privacyUrl`.
- Seller/VAT: `invoiceSellerName`, `invoiceSellerAddress`, `invoiceVatMode`,
  `invoiceVatRatePercent`, `invoiceExemptionBasisKind`, `invoiceExemptionBasis`.
- Invoicing policy: `invoicingProvider`, `autoIssueInvoices`,
  `autoIssueInvoiceScope`, `ksefSubmissionMode`. These do not supply provider
  credentials or solve shared-seller numbering across workspaces.
- Delivery: `shippingRates` (at most five unique rates) and the public
  `inpostGeowidgetToken`, which is not a ShipX secret. Existing delivery and
  vendor-script load rules continue to apply unchanged.

Empty strings clear the fields for which the existing settings route supports
that convention. Rate-mode VAT must not specify non-null exemption fields;
exempt-mode VAT must not specify a non-null numeric rate. The existing API also
checks the effective exemption basis. Do not enable automatic multi-workspace
KSeF issuance with shared seller credentials without a separate numbering design.

Version 1 rejects unknown keys at every manifest object boundary, including
provisioning, integrations, nested sender/settings fields, delivery estimates,
prices, stock and compliance. It accepts no passwords, session tokens, operator
secrets, inline Stripe/ShipX credentials or storage credentials. Integration
credentials are referenced only by environment variable name. Never embed
credentials in URLs either. Analytics policy and unrelated workspace settings
are outside this manifest's allow-list.

### Missing workspaces and operator provisioning

Use `"workspace": "acme"` when creation is not allowed. If the signed-in
account's workspace list does not contain it, plan and drift report it as
`"missing"` and apply stops before any write; if it is listed but cannot be
read, the command fails. It never silently provisions a string-only entry.
For deliberate creation, use the object form from the complete example:
`workspace.slug` plus `workspace.provision.name`, `ownerEmail`, and optional
`defaultLanguage`. These are bootstrap inputs, not ongoing owner/team or name
reconciliation. Manage the current name with `settings.name`.

A provisioning entry that is not in the account's workspace list, or whose
identity read returns `tenant_not_found`, is reported as
`provisioning: "create"`; an accessible existing workspace is `"unchanged"`.
Plan and drift need no operator secret. Authentication failures, permission
failures, generic 404 errors and workspace mismatches are not converted into
creation requests. Inactive workspaces may also be hidden by the server; the
tool does not reactivate them or bypass that policy.

For apply, inject `TOGETHER_SHOP_OPERATOR_SECRET` into the protected process
environment using your secret manager. Its value must match the server's
configured operator secret. There is no operator-secret flag or manifest field,
and the tool never prints the value. When any selected workspace needs creation,
a missing or empty variable fails apply before any write, including writes to
other, already existing shops.

The separate operator client targets the selected `--api-url` origin and sends
`POST /api/internal/tenants/provision` with header
`x-scheduler-operator-secret` and body `{slug, name, ownerEmail, defaultLanguage?}`.
It does not attach the owner-session Bearer token. Workspace clients never
receive that operator header. The existing route requires an already verified
global owner account; it does not create an account or weaken production's
self-service workspace-creation policy. Sign in as the owner who will administer
the provisioned shops.

The operator route is idempotent for the same slug and owner and rejects a slug
owned by someone else. The tool skips provisioning when the selected session
can already read that workspace. After all required provisioning calls it
re-reads every selected workspace and rebuilds the configuration diff before
further writes. A failed access check stops apply and reports any completed
provisioning operations; it does not roll them back. Retry reads current state
and does not create another workspace. The operator variable is unnecessary
when all selected workspaces already exist and are accessible.

### Explicit integration configuration

Only `shop apply --integrations` resolves integration environment references or
calls integration configure routes. Without that flag, apply leaves integrations
alone, and plan and drift list ShipX and the parcel-locker token as
`"skipped without --integrations"`. For Stripe, plan, drift and apply read the
workspace's masked secret listing (`GET /api/tenant-secrets`, key names and
masked previews only) and report `configured: true` when the restricted key,
webhook signing secret and webhook endpoint ID of the manifest's mode are all
stored; such a Stripe entry is reported as `"unchanged"`, otherwise as
`"skipped without --integrations"` or, with the flag, `"configure"`. The tool
never reads a secret value back, does not inspect integration environment values
without the flag except for the published-token comparison below, does not
compare stored credential values, and does not contact providers.

Company integration objects merge recursively with shop overrides, just like
settings. Shop references win. Set a provider (`stripe`, `shipx` or
`parcelLocker`) to `null` to opt that shop out; this skips configuration and does
not delete an existing provider or its credentials. Omitted providers are
unmanaged.

Environment references follow strict naming rules, because the server publishes
the parcel-locker token to anonymous checkout visitors and a wrong reference
would publish a secret or hand one provider's credential to another provider.
Each variable name is bound to its provider by a namespace; `<NAME>` below is one
or more segments of upper-case letters and digits separated by single
underscores:

- `stripe.restrictedKeyEnv` must match `SHOP_STRIPE_<NAME>`, for example
  `SHOP_STRIPE_TEST_KEY`.
- `shipx.tokenEnv` and `shipx.organizationIdEnv` must match `SHOP_SHIPX_<NAME>`,
  for example `SHOP_SHIPX_TOKEN` and `SHOP_SHIPX_ORGANIZATION_ID`.
- `parcelLocker.tokenEnv` must match `SHOP_GEOWIDGET_PUBLIC_TOKEN` or
  `SHOP_GEOWIDGET_<NAME>_PUBLIC_TOKEN`, for example
  `SHOP_GEOWIDGET_STUDIO_PUBLIC_TOKEN`.
- The Stripe and ShipX fields are secret and must not use a name containing the
  `PUBLIC` marker as a separate segment.
- Other variables, including database, session and provider variables of the
  deployment, cannot be referenced, and `TOGETHER_SHOP_OPERATOR_SECRET` can never
  be referenced by a manifest.
- One variable name can be referenced by only one provider field in the
  effective configuration of a shop, after company and shop settings merge.

The manifest parser enforces these rules, and the tool checks them again on the
merged configuration of every selected shop before the first request and again
before reading any value. Error messages name the rule, never a value.

A value with the shape of a Stripe secret or restricted key (`sk_test_`,
`sk_live_`, `rk_test_` or `rk_live_` followed by key characters) is accepted
only from the variable named by `stripe.restrictedKeyEnv`. The parser refuses
such a value anywhere in the manifest itself, and `shop apply --integrations`
refuses it in the variables of the ShipX fields and the parcel-locker token
before any write. The error names the rule, never the value.

Because the parcel-locker token is published to checkout visitors,
`shop apply` also refuses, before any write, a run that would publish a
credential. It collects every token the run would publish: with
`--integrations`, the values of the `parcelLocker.tokenEnv` variables of all
selected shops, and, with or without the flag, every literal
`settings.inpostGeowidgetToken` in their effective settings. It compares them,
after surrounding whitespace is trimmed, with the values of the ShipX token and
ShipX organization ID variables referenced anywhere in the manifest (the
`company` block and every shop entry, also when `--shop` selects only one of
them) and with `TOGETHER_SHOP_OPERATOR_SECRET` when that variable is set, so a
ShipX token of one shop cannot become the public token of another, even when
that other shop is applied alone. These carrier and operator
variables are read for this comparison only when the run publishes a token. The
error names the rule, the publishing workspaces and the shops whose credential
matched (`company block` for the company block, or the operator secret), never a
value.

The comparison covers only credentials referenced by the manifest and the
operator secret. Carrier credentials stored earlier in a
workspace, by an earlier apply, another manifest or Studio, are not compared,
because the tool never reads stored secret values; a public token equal to such
a stored credential is not detected. A server-side check is a later change.

| Manifest input | Environment value / accepted setting | Existing write route |
| --- | --- | --- |
| `stripe.restrictedKeyEnv` | Restricted Stripe key; never a webhook secret | `POST /api/integrations/stripe/configure` |
| `stripe.mode` | Explicit `test` or `live`, matching the restricted key prefix | Same route |
| `shipx.tokenEnv` | ShipX API token | `POST /api/integrations/shipx/configure` |
| `shipx.organizationIdEnv` | Numeric ShipX organization ID | Same route |
| `shipx.environment` | Optional `sandbox` or `production` | Same route |
| `shipx.sender` | Optional existing sender object, or `null` to clear it | Same route |
| `parcelLocker.tokenEnv` | Public InPost Geowidget token | `POST /api/tenant/settings` as `inpostGeowidgetToken` |

ShipX fields are optional individually; at least one field must be supplied in
a ShipX block. Sender fields are `name`, nullable `company`, `email`, Polish
`phone`, `street`, `buildingNumber`, `city`, and `postCode`. The existing route's
validation applies. Omitted fields preserve stored settings. This manifest does
not expose credential deletion or shipment creation. The parcel-locker token is
public checkout configuration, not a ShipX API token; do not manage it through
both `settings.inpostGeowidgetToken` and `integrations.parcelLocker` in the same
effective shop. Existing vendor-script document and load conditions are unchanged.

The example uses `SHOP_STRIPE_TEST_KEY`, `SHOP_SHIPX_ORGANIZATION_ID`,
`SHOP_SHIPX_TOKEN`, and `SHOP_GEOWIDGET_PUBLIC_TOKEN`. Load their values from
protected runtime configuration, not arguments, JSON, shell history or printed
output.
All selected shops' references, resolved route inputs, and Stripe key/mode
compatibility are checked before any provisioning, settings or provider write.
Missing variables and invalid values fail with sanitized validation errors.

Each selected shop calls Stripe configure independently, even when the same
company key references the same Stripe account. The existing provider flow
registers that workspace's own webhook URL, endpoint ID and signing secret,
preserving other workspaces and the other live/test slot. No signing secret,
endpoint ID, customer, subscription or ledger is copied between shops or read
back by the tool. Stripe permissions, endpoint capacity and credentials remain
external preflight requirements, not guarantees made by this manifest.

Stripe configure registers the workspace's webhook endpoint again and replaces
its signing secret on every call, so `shop apply --integrations` calls it only
for a mode the workspace does not report as configured. A configured mode is
reported as `"unchanged"` and nothing is sent, even when the referenced key has
changed, because the tool cannot compare stored credential values. To rotate
the key or register the endpoint again, add `--reconfigure-payments`; it is
accepted only together with `--integrations` and forces the Stripe configure
call for every selected shop with a Stripe entry. The ShipX configure route
stores the supplied environment, sender and credentials and registers nothing
with the provider, so a repeated call writes the same values again; ShipX and
the parcel-locker token are therefore configured on every
`--integrations` apply. Use the flag deliberately for approved provider
setup/rotation, not in a drift job or every catalogue update. On failure, completed operations remain applied;
a provider transport failure can leave an uncertain external outcome. Inspect
the provider/workspace state through the approved operational process before
retrying. Never copy an old webhook secret into another workspace.

### Products

A product is identified by its workspace-local `slug`. Required fields are
`slug`, `title`, `price` and `published`. `type` defaults to `physical` and no
other type is accepted. A matching slug belonging to another product type is an
error; the tool does not convert product types or rename slugs.

The metadata fields follow the existing physical product routes: `description`,
`vatRate`, `vatExemptionBasis`, `deliveryMethod`, `parcelTemplate`, `compliance`,
`variantGroup`, `variantLabel`, and `coverUrl`. Only the metadata fields an
entry specifies are managed: an omitted field of an existing product is not
compared or written and keeps its stored value. When the tool creates a product,
the product route's defaults fill omitted fields: an empty description, delivery
method `pickup` and parcel template `medium`. The plan lists the managed
metadata field names of every product under `managedFields` and those that
differ under `fields`. Use `null` to clear nullable metadata. Omitted product VAT
inherits the workspace treatment on new products; use an explicit `null` to
return an existing product to inheritance. `compliance` is managed as a whole
object: when it is specified, an omitted `safetyWarnings` inside it is written
as an empty string.

`vatExemptionBasis` must describe the value the product routes store, so that a
second apply finds nothing to change. A string basis requires `"vatRate":
"exempt"`. A `null` basis requires an explicit rate (`5`, `8`, `23` or `null`).
For an exempt product, omit `vatExemptionBasis` to let the product route copy
the workspace's exemption basis when the product becomes exempt, or set the
basis string explicitly; `"vatRate": "exempt"` with a `null` basis is rejected
before any request, because the route stores the workspace basis instead of
`null`.

`price` describes one active, non-imported, one-time sellable price, with an
integer nonnegative `amountCents` and an uppercase three-letter `currency`.
Amounts are in minor currency units, not decimal major units. The tool creates a
new price only when no active usable price has the desired amount and currency;
it then deactivates other active prices so exactly one remains. The plan lists
those price IDs under `deactivatePriceIds`. Inactive prices remain in history.
Product base-price metadata is set on creation, but is not rewritten on existing
products: the active sellable price is the authoritative managed value.

`stock` is optional. When provided, `onHand` is an integer from 0 to 1,000,000.
The tool enables tracking if needed or applies a delta to reach that on-hand
count, not the available count. Existing reservations and thresholds are not
changed. Omission leaves stock unmanaged; it does not disable tracking.

`coverUrl` accepts the existing route's HTTP(S) or root-relative asset URL.
Omission preserves the existing cover, and `null` clears it. The command attaches
an already available URL and never uploads image bytes. `published` explicitly
publishes or unpublishes the product after all other selected changes.

Products absent from the manifest are untouched. The tool does not delete
products, change visibility, configure access grants or rewrite stock lifecycle
or checkout calculations. Existing publication prerequisites still apply.

## Plan and apply

```bash
pnpm --silent run cli --json --api-url http://localhost:48730 shop plan --manifest ./shop.json
pnpm --silent run cli --json --api-url http://localhost:48730 shop apply --manifest ./shop.json
pnpm --silent run cli --json --api-url http://localhost:48730 shop plan --manifest ./shop.json --shop acme
pnpm --silent run cli --json --api-url http://localhost:48730 shop drift --manifest ./shop.json
```

For separately approved sandbox/provider setup, after loading the documented
environment variables in a protected environment:

```bash
pnpm --silent run cli --json --api-url http://localhost:48730 shop apply --manifest ./shop.json --integrations
pnpm --silent run cli --json --api-url http://localhost:48730 shop apply --manifest ./shop.json --integrations --reconfigure-payments
```

`plan` only reads. Its per-shop report includes settings field names to change
and unchanged settings, product creation/update/unchanged status and metadata
field names, desired price and price additions/deactivations, stock action and
desired on-hand, cover action, and publication action. Settings values and cover
URLs are not printed. The tool does not print session credentials or echo raw
manifest/parser/server error values. `unmanaged` distinguishes an omitted stock
or cover from a managed field already at its target.

`apply` recomputes that same plan from current state; it does not consume a saved
plan file. It preflights all selected shops and required environment inputs
before the first write. Missing workspaces are provisioned first, followed by a
new configuration preflight. Within each shop, writes are serial and run in this
order:

1. Changed workspace settings.
2. With `--integrations` only: Stripe, ShipX, then parcel-locker configuration.
3. All product creations and metadata updates by slug.
4. Active prices: add a replacement if needed, then deactivate alternatives.
5. Stock enablement or on-hand adjustments.
6. Cover attachment or clearing.
7. Publication changes.

A successful apply returns the executed plan and an `applied` operation list.
Run apply again without `--integrations` or external changes and every managed
item is unchanged, with an empty `applied` list and no writes. There is no extra
price or workspace on rerun. With `--integrations`, ShipX and parcel-locker
configuration are repeated on every run, and Stripe configuration only for a
mode that is not yet configured or with `--reconfigure-payments`.

On the first API error, apply stops immediately. The ordinary failure envelope
retains the existing error code, identifies the failed operation/workspace under
`error.details.failure`, and lists successful earlier writes under
`error.details.applied`; human output includes the same operation list in the
error message. An API read failure during the initial preflight means no writes
have begun; a read failure after provisioning reports that completed prefix.
The process exit code comes from the existing CLI error taxonomy, for example
validation = 2 and authentication required = 3.

This is not a cross-request transaction and has no automatic rollback. Earlier
successful writes remain applied. Correct the cause, inspect a fresh plan, then
rerun; current state is the recovery checkpoint. A transport failure may leave
the final attempted write's server outcome unknown, so read state before retrying.
Serialize applies and avoid concurrent catalogue edits, stock writers or sales
while reconciling an absolute on-hand target: the existing stock route accepts a
delta, not a compare-and-set operation. A plan is a preview, not a lock on live
workspace state. No production or provider mutation is implied by this guide.

### Exit codes

The three commands print their report or failure envelope first and then set
the process exit code, so a job can use them as gates:

- `shop plan`: `0` when the plan was read and every selected shop exists or will
  be created by a provisioning entry, whether or not changes are pending.
  Validation exit code `2`, with the complete `ok: true` report still printed,
  when any selected string-form workspace is reported as
  `provisioning: "missing"` (mistyped, revoked or absent from the account's
  workspace list). Any other failure keeps its CLI taxonomy exit code with
  `ok: false`.
- `shop apply`: `0` when every selected change was applied or nothing was
  pending; otherwise the exit code of the first error (validation `2`,
  including missing workspaces, authentication required `3`, and so on), with
  `ok: false` and the completed operations under `error.details.applied`.
- `shop drift`: `0` when converged, `1` when drift is reported (see Scheduled
  drift detection), otherwise the exit code of the error with `ok: false`.

## Scheduled drift detection

`shop drift --manifest ./shop.json` performs the same read-only diff as plan and
adds `drifted: true|false`. It accepts the same `--shop <slug>` filter and never
accepts `--integrations`. In JSON mode it emits exactly one normal envelope;
ordinary drift is a successful read (`ok: true`), not an API failure.

- Exit `0`: every managed workspace setting/product is at its target.
- Exit `1`: at least one workspace needs provisioning or is missing from the
  account's workspace list, a settings field differs,
  or a managed product/price/stock/cover/publication action is pending.
- Read, authentication and validation errors retain the existing CLI taxonomy
  (for example validation `2`, authentication required `3`), with `ok: false`.
  Treat these as failed checks, not evidence that state is synchronized.

This lets a scheduled job detect unapplied company changes without reapplying
secrets or contacting payment/shipping providers. Integrations do not make
`drifted` true, including a Stripe mode that is not configured: the tool
intentionally cannot compare stored credential values. Omitted fields and products absent from the manifest
are also unmanaged, not drift. A converged drift report is not payment-provider
readiness evidence. Keep the owner session fresh and store the manifest and
session profile in protected automation storage.
