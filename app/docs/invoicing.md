# Fakturownia and invoices

Together delegates fiscal issuance and KSeF submission to the tenant's Fakturownia account.

## Connect Fakturownia

1. Configure KSeF in Fakturownia. The KSeF certificate stays there and is never stored by Together.
2. In Together, open **Integrations → Fakturownia**.
3. Save the Fakturownia API key and the account subdomain. Both values are encrypted with the same tenant-secret mechanism used for Stripe and other integrations.
4. Complete a paid test order with billing data, open it in **Sales**, and select **Issue invoice**.

Provider authentication failures ask the owner to replace the API key. Validation failures point back to the order's billing snapshot. Network failures can be retried from the order.

## Automatic issuance

Automatic issuance is off by default. The owner can enable it under **Settings → Automatic invoices** and select one scope:

- **Orders with a tax ID only** issues only B2B orders whose billing snapshot contains a valid NIP. Other paid orders receive a recorded skip event.
- **All orders** also issues B2C invoices. When the buyer did not request billing data, Fakturownia's retail-buyer defaults are used.

Invoice automation runs after payment fulfillment, coupon accounting, and consent capture. Provider failure never rolls back the purchase or access grant; the failed invoice and its lifecycle event remain available for a retry.

## B2C requests

A buyer can request an invoice during checkout without a NIP by supplying their name and address. If they did not request one at checkout, staff can use the Fakturownia link-out workflow within the applicable three-month issuance window. Paid-order billing snapshots cannot be edited.

## Retention

Invoices and invoice lifecycle events are fiscal records. Member erasure pseudonymizes the member as usual but does not delete invoice rows or their order relationship.
