# Payments

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
Erased members cannot receive an adopted subscription.

For automation, append `--api-key <secret>` to either CLI command, using a tenant
API key with the `enrollment` scope. The corresponding HTTP endpoints are
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
Studio and signed-in CLI sessions use staff-authorized subscription endpoints.

Adoption does not replay invoices received before the local subscription existed.
Schedule the cutover so webhook delivery and adoption overlap as little as
possible, then reconcile any invoices delivered during the transition. Keep
existing customer portal configuration on the same Stripe account; customers
continue using their existing subscription and payment method.
