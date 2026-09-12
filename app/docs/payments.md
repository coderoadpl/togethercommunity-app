# Payments

## Test mode for staff

A tenant owner can configure an independent Stripe sandbox in Studio → Integrations → Stripe → Test mode. Create a restricted key in the tenant's Stripe sandbox and enter the `rk_test_` key in this card. Grant the same checkout, subscription and webhook permissions shown for the live integration. The live card accepts only `rk_live_` keys; the test card accepts only `rk_test_` keys, including when credentials are saved through the API.

An installation whose live card already holds an `rk_test_` key predates the two slots. The live card now refuses it, the checkout page reports the tenant as not configured, and Studio marks the live card as holding a sandbox key. Paste that key into the **Test mode** card, then remove it from the live card and save an `rk_live_` key there. Orders already recorded through the sandbox key stay `mode=live`; the payment-mode filter will not separate them.

Configuration registers a separate webhook endpoint at `/api/webhooks/stripe/<tenantId>?mode=test`. The card shows whether its signing secret is configured and when the last signature-verified test event arrived. Removing test mode unregisters that endpoint and removes the sandbox credentials and status. Live credentials and existing purchases remain intact.

Sign in as an owner or admin on the tenant's own domain, open a public product checkout, and enable **Stripe test mode**. The switch starts off, appears only once the sandbox key is saved, and is hidden from members and anonymous visitors. The server binds an encrypted, one-hour flag to the staff account and tenant and checks staff membership again when checkout starts. The flag is cleared after checkout creation. Impersonation cannot enable test checkout, and a `mode` field in the checkout body cannot select test mode.

Select a paid one-time or recurring price. The coupon field and the free-purchase action are disabled while the switch is on, and the server refuses a coupon or a zero price before it creates anything. The purchase is assigned to the signed-in staff account. Complete Stripe Checkout with a [Stripe test card](https://docs.stripe.com/testing), for example `4242 4242 4242 4242`, a future expiry date and a three-digit CVC. The return page identifies the purchase as a test for staff of the same tenant only. This banner confirms the checkout mode; webhook delivery completes fulfilment.

Test orders, subscriptions and grants carry `mode=test`. Studio sales and member details identify them with **TEST** and provide a payment-mode filter. Test grants do not unlock member access or change an existing live grant. Test rows are excluded from revenue, sales counts, active-subscription counts, reconciliation and exports. Test checkout records no consent capture and does not redeem coupons or send Together transactional or marketing-consent email to members; diagnostic messages go to the platform log. Automatic and manual invoice issuance are disabled for test orders. Coupons and free purchases use the ordinary checkout flow.

Each endpoint verifies its own signing secret and checks Stripe's signed `livemode` value. Every correlated order and subscription must match the endpoint mode. Test checkout events additionally require a recorded test checkout session; unknown test events and all cross-mode correlations are acknowledged with `processed:false` and a logged reason. A pending order is stored before the checkout URL is returned, so an unrelated sandbox event cannot create access.

The CLI offers the same configuration operations:

```sh
together stripe test-mode status
together stripe test-mode configure rk_test_example
together stripe test-mode remove
```

Keep credentials out of shared terminal history. Test records are retained as audit history; removal disconnects the integration and does not purge records. Stripe documents the separation between sandbox and live credentials in [API keys](https://docs.stripe.com/keys).
