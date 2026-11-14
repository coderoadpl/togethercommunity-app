# Declarative shop manifests

Use `shop plan` and `shop apply` to configure existing workspaces and their
physical-product catalogues from one JSON file. Both commands use the existing
session management API through `core/client`; they do not create workspaces,
configure integration credentials, upload images, or make payments.

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

On `togethercommunity.app`, the command targets each workspace's subdomain using
the session from that selected API origin. An existing `.localhost` subdomain is
similarly replaced for each shop. Other API origins are retained and receive the
workspace header. Before reading settings or catalogue data, the command checks
`/api/me` and refuses a workspace mismatch. A custom workspace domain that takes
precedence over the header therefore works only for its matching shop: use the
correct origin and `--shop` for each workspace. Self-hosted multi-workspace API
origins must support the workspace selector.

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

`company` is optional and contains `settings`. Each shop has a required
`workspace` slug, optional `settings`, and a required `products` array (which may
be empty). Workspace slugs and product slugs within one shop must be unique.

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
nested settings, delivery estimates, prices, stock and compliance. It accepts no
passwords, session tokens, API keys, payment secrets, ShipX credentials or storage
credentials. Never embed credentials in URLs either. Provisioning and integration
blocks are reserved for later additive extensions; they are not accepted by this
version's schema. Analytics policy and unrelated workspace settings are outside
this manifest's allow-list.

### Products

A product is identified by its workspace-local `slug`. Required fields are
`slug`, `title`, `price` and `published`. `type` defaults to `physical` and no
other type is accepted. A matching slug belonging to another product type is an
error; the tool does not convert product types or rename slugs.

The metadata fields follow the existing physical product routes: `description`,
`vatRate`, `vatExemptionBasis`, `deliveryMethod`, `parcelTemplate`, `compliance`,
`variantGroup`, `variantLabel`, and `coverUrl`. Description defaults to an empty
string, delivery method to `pickup`, and parcel template to `medium`; these
defaults are managed values, including for existing products. Other omitted
optional metadata fields are preserved on existing products. Use `null` to clear
nullable metadata. Omitted product VAT inherits the workspace treatment on new
products; use an explicit `null` to return an existing product to inheritance.

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
```

`plan` only reads. Its per-shop report includes settings field names to change
and unchanged settings, product creation/update/unchanged status and metadata
field names, desired price and price additions/deactivations, stock action and
desired on-hand, cover action, and publication action. Settings values and cover
URLs are not printed. The tool does not print session credentials or echo raw
manifest/parser/server error values. `unmanaged` distinguishes an omitted stock
or cover from a managed field already at its target.

`apply` recomputes that same plan from current state; it does not consume a saved
plan file. It preflights all selected shops before the first write. Within each
shop, writes are serial and run in this order:

1. Changed workspace settings.
2. All product creations and metadata updates by slug.
3. Active prices: add a replacement if needed, then deactivate alternatives.
4. Stock enablement or on-hand adjustments.
5. Cover attachment or clearing.
6. Publication changes.

A successful apply returns the executed plan and an `applied` operation list.
Run apply again without external changes and every managed item is unchanged,
with an empty `applied` list and no writes. There is no extra price on rerun.

On the first API error, apply stops immediately. The ordinary failure envelope
retains the existing error code, identifies the failed operation/workspace under
`error.details.failure`, and lists successful earlier writes under
`error.details.applied`; human output includes the same operation list in the
error message. An API read failure during preflight means no writes have begun.
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
