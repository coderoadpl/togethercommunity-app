# Transactional M2M e-mail API

Create a tenant API key with the `transactional` scope. Existing unscoped keys keep their legacy enrollment and marketing access and cannot use this API.

An owner can create the limited key through `POST /api/api-keys` with `{"name":"orders-app","scopes":["transactional"]}`. The secret is returned once.

Send the key in `x-api-key`. Resolve the tenant through its normal tenant hostname or send the tenant slug in `x-tenant` when using a shared host.

## Submit a message

`POST /api/m2m/transactional/messages`

```http
POST /api/m2m/transactional/messages HTTP/1.1
Host: shop.example.com
Content-Type: application/json
x-api-key: together_api_key

{
  "to": "buyer@example.com",
  "subject": "Your receipt",
  "html": "<p>Payment received.</p>",
  "text": "Payment received.",
  "replyTo": "support@example.com",
  "idempotencyKey": "order-123-receipt-v1"
}
```

At least one of `html` or `text` is required. Custom headers are not accepted. The key is rate-limited independently from other tenant API keys.
The complete JSON request body is limited to 512 KiB, including field names and JSON encoding overhead.

A new message returns `202 Accepted`:

```json
{
  "ok": true,
  "data": {
    "messageId": "message-id",
    "statusUrl": "/api/m2m/transactional/messages/message-id"
  }
}
```

Repeating the same request with the same `idempotencyKey` returns the original message ID with `200 OK` and does not enqueue another message. Reusing the key for a different request returns `409 Conflict`.

## Read message status

`GET /api/m2m/transactional/messages/:id` returns the unified send projection and its delivery events. Use the same tenant API key authentication.

## Errors

- `400` for an invalid or oversized payload.
- `401` for a missing or invalid API key.
- `403` when the API key lacks the `transactional` scope.
- `409` when an idempotency key was used for a different request.
- `412` when the tenant has no configured SES, SMTP, or Resend transport.
- `422` when the recipient has an active hard-bounce, complaint, or erasure suppression. Global marketing unsubscribe does not block transactional mail.
- `429` when the per-key minute or daily limit is exceeded. Honor the `Retry-After` response header.

API-submitted messages never use Together's platform fallback pool. They enter the normal transactional outbox and appear in the send log with the API key name as the source app.
