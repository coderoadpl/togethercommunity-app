# Payments

## Test mode for staff

A tenant owner can configure an independent Stripe sandbox in Studio → Integrations → Stripe → Test mode. Create a restricted key in the tenant's Stripe sandbox and enter the `rk_test_` key in this card. Grant the same checkout, subscription and webhook permissions shown for the live integration. The live card accepts only `rk_live_` keys; the test card accepts only `rk_test_` keys, including when credentials are saved through the API.

An installation whose live card already holds an `rk_test_` key predates the two slots. The live card now refuses it, the checkout page reports the tenant as not configured, and Studio marks the live card as holding a sandbox key. The live webhook endpoint also now discards every delivery from that sandbox account (a signed `livemode:false` event on the live slot), so renewals stop renewing and cancellations stop revoking until the key is moved. Paste that key into the **Test mode** card, then remove it from the live card and save an `rk_live_` key there. Orders already recorded through the sandbox key stay `mode=live`; the payment-mode filter will not separate them.

Configuration registers a separate webhook endpoint at `/api/webhooks/stripe/<tenantId>?mode=test`. The card shows whether its signing secret is configured and when the last signature-verified test event arrived. Removing test mode unregisters that endpoint and removes the sandbox credentials and status. Live credentials and existing purchases remain intact.

Sign in as an owner or admin on the tenant's own domain, open a public product checkout, and enable **Stripe test mode**. The switch starts off, appears only once the sandbox key is saved, and is hidden from members and anonymous visitors. The server binds an encrypted, one-hour flag to the staff account and tenant and checks staff membership again when checkout starts. The flag is cleared after checkout creation. Impersonation cannot enable test checkout, and a `mode` field in the checkout body cannot select test mode.

Select a paid one-time or recurring price. The coupon field and the free-purchase action are disabled while the switch is on, and the server refuses a coupon or a zero price before it creates anything. The purchase is assigned to the signed-in staff account. Complete Stripe Checkout with a [Stripe test card](https://docs.stripe.com/testing), for example `4242 4242 4242 4242`, a future expiry date and a three-digit CVC. The return page identifies the purchase as a test for staff of the same tenant only. This banner confirms the checkout mode; webhook delivery completes fulfilment.

Test orders, subscriptions and grants carry `mode=test`. Studio sales and member details identify them with **TEST** and provide a payment-mode filter. Test grants do not unlock member access or change an existing live grant. Test rows are excluded from revenue, sales counts, active-subscription counts, reconciliation and exports. Test checkout records no consent capture and does not redeem coupons or send Together transactional or marketing-consent email to members; diagnostic messages go to the platform log. Automatic and manual invoice issuance are disabled for test orders. Coupons and free purchases use the ordinary checkout flow.

A pre-existing unique index still constrains `product_grants` to one row per tenant, member and product regardless of mode. A staff test purchase of a product the staff account already holds live is a no-op: it records the test order (and subscription, if any) but skips the test grant, so the existing live grant is untouched. The reverse direction is handled the other way around because it involves real money: a live purchase, manual grant or subscription renewal for a member+product that a prior staff test purchase already granted reclaims the row from the stray test grant and writes the live one. The bulk member-grant importer does not: it still fails that one row as a conflict, so clear a stray test grant first if an import reports one. Testing a product the staff account does not already own live, in either mode, is unaffected. Lifting the underlying index constraint requires a follow-up, owner-reviewed migration that drops the old index once no previous release still relies on it.

Each endpoint verifies its own signing secret and checks Stripe's signed `livemode` value. Every correlated order and subscription must match the endpoint mode. Test checkout events additionally require a recorded test checkout session; unknown test events and all cross-mode correlations are acknowledged with `processed:false` and a logged reason. A pending order is stored before the checkout URL is returned, so an unrelated sandbox event cannot create access.

The CLI offers the same configuration operations:

```sh
together stripe test-mode status
together stripe test-mode configure rk_test_example
together stripe test-mode remove
```

Keep credentials out of shared terminal history. Test records are retained as audit history; removal disconnects the integration and does not purge records. Stripe documents the separation between sandbox and live credentials in [API keys](https://docs.stripe.com/keys).

## Adopting existing Stripe subscriptions

Adoption connects a live subscription in the tenant's existing Stripe account to
an existing Together member and product. Together does not create or modify a
Stripe subscription, price, customer, payment method or billing schedule during
adoption. Subsequent invoices, payment failures and cancellations use the native
subscription lifecycle and the tenant's configured Stripe customer portal.

1. Connect the tenant's existing Stripe account in Studio. The restricted key must
   permit reading subscriptions and customers. Configure the Together webhook for
   that account, including `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Configure
   the account's customer portal login URL in the tenant's Stripe settings.
2. Import or create the members and products first. Confirm member email addresses
   match the corresponding Stripe customers. Stop the old platform from changing
   subscription access after the migration cutover; adoption itself leaves Stripe
   billing untouched.
3. Select the tenant and inventory its subscriptions:

   ```sh
   together --tenant acme --json subscriptions list-stripe --status active --unadopted
   together --tenant acme --json subscriptions list-stripe --status past_due --unadopted
   ```

   Each page contains at most 100 Stripe subscriptions and a `nextCursor`. Continue
   with `--starting-after <nextCursor>` until the cursor is null, including when a
   filtered page is empty. Each result includes the Stripe ID, status, provider
   price ID and an `adopted` flag. Customer emails are omitted from the inventory.
4. Adopt each subscription, selecting the Together product it grants:

   ```sh
   together --tenant acme --json subscriptions adopt \
     --subscription sub_example --member member-example --product product-example
   ```

   `--member` accepts a member ID or email. `--price` optionally selects an existing
   recurring price on that product; it must be either unlinked or already linked to
   the same Stripe price, and its amount, currency and interval may differ from
   Stripe. Without it, adoption reuses the price whose provider price ID equals the
   Stripe price, or creates an inactive price marked `imported`, with
   `provider_price_id` and Stripe's amount, currency, interval and interval count.
   Imported prices cannot be activated or used for new checkout sessions. No
   historical order is invented.
5. Review the result: `subscriptionCreated`, `priceCreated`, `grantCreated` and
   `grantExtended` distinguish new records from reused ones. Repeating the same
   adoption is both safe and the supported recovery: it keeps the existing records,
   refreshes status, period end and cancellation flag from Stripe, recreates a
   deleted price or grant, and re-applies the extend-never-shorten access rule, so
   revoked access and a renewal missed during the cutover are restored. A different
   member, product or explicit price for an already owned Stripe subscription is
   refused.
6. Check the member's access and timeline in Studio. Adoption records an immutable
   `subscription-adopted` event whose payload contains only subscription and
   product/price IDs. Existing longer or lifetime access is preserved. A new or
   shorter grant reaches the Stripe period end. Future paid invoices apply the
   normal renewal and grace-period policy; failures and cancellations follow the
   existing subscription lifecycle.

Only `active` and `past_due` subscriptions are eligible. The subscription must be
retrievable with this tenant's restricted key. Adoption currently supports a
single fixed recurring price, including daily, weekly, monthly and yearly prices
and their interval counts. Multi-item or tiered subscriptions are refused rather
than represented with incomplete price information.

An absent or mismatched Stripe customer email is refused by default. After
independently verifying the customer/member mapping, an operator can explicitly
pass `--allow-email-mismatch`. The Studio member access action, **Adopt Stripe
subscription**, asks for the subscription ID and product and always checks email.
Erased members cannot receive an adopted subscription. The product must be published,
including when repeating adoption to reconcile existing access.

For automation, append `--api-key <secret>` to either CLI command, using a tenant
API key with `subscriptions:read` for listing or `subscriptions:adopt` for adoption.
These scopes are independent; use both when both operations are needed. Legacy
unscoped keys and enrollment-only keys cannot use either endpoint. Subscription
scopes cannot be combined with import scopes. The corresponding HTTP endpoints are
`POST /api/m2m/subscriptions/adopt` and `GET /api/m2m/subscriptions/stripe`, with
`x-api-key` and the normal tenant selection header or hostname. The POST body is:

```json
{
  "subscriptionId": "sub_example",
  "memberId": "member-example",
  "productId": "product-example"
}
```

Use exactly one of `memberId` or `email`; optional fields are `priceId` and
`allowEmailMismatch`. The listing query accepts `status`, `unadopted=true` and
`startingAfter`. Both M2M endpoints share a tenant limit of 60 requests per minute.
Studio and signed-in CLI sessions require the corresponding `subscriptions:read`
or `subscriptions:adopt` capability, granted only to owners and admins.

Adoption does not replay invoices received before the local subscription existed.
Schedule the cutover so webhook delivery and adoption overlap as little as
possible, then reconcile any invoices delivered during the transition. Keep
existing customer portal configuration on the same Stripe account; customers
continue using their existing subscription and payment method.
