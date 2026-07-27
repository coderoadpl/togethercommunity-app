# iFirma and invoices

Together delegates VAT invoice issuance to the tenant's iFirma account. The tenant remains the seller of record. Together stores the paid order ledger, immutable billing snapshot, iFirma document reference, assigned invoice number, and lifecycle events.

## Connect iFirma

1. Sign in to iFirma and open the account API configuration.
2. Enable the API and generate the symmetric key named `faktura`. The other named keys (`abonent`, `rachunek`, and `wydatek`) do not authorize invoice operations.
3. Configure KSeF inside iFirma. KSeF credentials and certificates stay in iFirma and never reach Together.
4. In Together, open **Integrations → iFirma**.
5. Save the iFirma username and the `faktura` API key. Both fields are write-only: after saving, Together displays only masked previews.
6. Select **Test connection**. The test performs an authenticated, read-only invoice-list request and does not create a document.
7. In **Settings → Automatic invoices**, select the tenant's applicable VAT rate. Together supports 5%, 8%, and 23% domestic invoices in v1 and refuses issuance until a rate is selected.
8. Complete a paid test order with billing data, open it in **Sales**, and select **Issue invoice**.

If the connection test reports rejected credentials, verify the login, confirm that the saved key is the `faktura` key, and generate a replacement key in iFirma if necessary. A validation error means iFirma accepted authentication but rejected the account configuration or document data. An unavailable error indicates a network or iFirma technical failure and can be retried.

## What Together sends

Together creates a paid domestic VAT invoice in PLN for a Polish billing address. Its position uses the final gross amount stored in the paid order ledger, not a current product price. When a coupon was applied, the Polish position note includes the discount amount from the order ledger. The buyer comes from the immutable checkout billing snapshot; a B2B buyer includes the NIP, while a B2C buyer does not.

iFirma assigns the fiscal number. Together persists the iFirma identifier immediately after creation, then reads the document back by that identifier. A retry resumes from the stored identifier and never creates a second fiscal document. If the create request loses its response before an identifier can be stored, Together blocks automatic retry and directs staff to reconcile the document in iFirma first. PDF downloads are fetched by Together with the tenant credentials and streamed to the authenticated staff browser.

iFirma requires query parameters to be excluded from the URL used to calculate its HMAC authentication header. The adapter follows the [official authentication-header specification](https://api.ifirma.pl/naglowek-autoryzacji/).

## Automatic issuance

Automatic issuance is off by default. The owner can enable it under **Settings → Automatic invoices** and select one scope:

- **B2B only** issues an invoice only when the paid order billing snapshot contains a NIP. Paid B2C orders are recorded as skipped.
- **All orders** also issues a B2C invoice when no NIP is present. If the checkout had no billing snapshot, Together sends an individual retail-buyer record without a NIP.

Automatic issuance runs outside the payment-webhook response path after payment fulfillment. Provider requests time out after eight seconds. An iFirma failure never rolls back the purchase, payment, or access grant. The failed invoice projection and lifecycle event remain available for diagnosis and retry. Subscription renewal orders carry the original billing snapshot and are eligible for the same automatic or staff-triggered issuance flow.

## B2C invoices on request

A buyer can reveal the invoice fields during checkout and supply a name and address without a NIP. Staff can issue that B2C invoice from the paid order detail during the applicable three-month request window.

If the buyer did not request an invoice during checkout, the paid order has no billing snapshot and Together cannot add or edit one after payment. Handle that exceptional request directly in iFirma within the applicable legal window, using the paid order ledger as the amount source.

## Retention and erasure

Paid-order billing snapshots are immutable. Invoices and their append-only lifecycle events are fiscal records. Member erasure pseudonymizes the member but does not delete invoice rows or their order relationship.
