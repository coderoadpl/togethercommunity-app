# Change proposals

A change proposal is a write that a machine asked for and the workspace owner
has not yet decided on. It comes from a [shop management key](shop-management-keys.md)
created in **propose mode**: such a key reads what its read scopes allow, and
every catalogue write it sends is stored as a proposal instead of changing the
live shop. The owner reads each proposal with a field-level before/after and
rejects it; approval is not available yet (see [Not yet available](#not-yet-available)).

## Status

| Surface | Status |
|---|---|
| Propose-mode shop management keys (`mode: "propose"`) | Available |
| Proposals for the ten catalogue write routes | Available |
| Key-side list, read and withdraw (`/api/m2m/shop/proposals`) | Available |
| Owner-session list, read and reject (`/api/change-proposals`) | Available |
| Withdrawal of pending proposals when their key is revoked or purged | Available |
| Typed client outcomes and CLI commands | Available |
| Approve, sales links, settings, images, groups, owner panel | Not yet available |

## What a proposal is

A proposal stores two things:

- **The command**: a closed `operation` name and its `input`, parsed by the
  same strict schema as the live route, with every default filled in. The
  stored input is what an approval will run, never a re-read of the original
  request.
- **The effect**: what the command would change. It is computed by a dry run:
  the live use-case runs inside one database transaction, on the target row
  locked for update, acting as the owner who issued the key, and the
  transaction is always rolled back. The effect is the field-level difference
  between the target before and after (`{ "title": { "before": "A", "after":
  "B" } }`), derived fields included, such as the published flag, the active
  prices or a VAT exemption basis taken from the settings. A stock adjustment
  is stored as a delta (`{ "onHand": { "delta": 5 } }`), never as an absolute
  balance.

The dry run never leaves a row, an event, an outbox message or a content
version behind, and object storage deletes that a live operation would make
are dropped with the rollback. A domain error from the dry run is returned to
the key exactly as the live route returns it (`400`, `404`, `409`) and no
proposal is stored.

| Operation | Live route | Target |
|---|---|---|
| `product.create` | `POST /api/m2m/shop/products` | a new product |
| `product.update` | `POST /api/m2m/shop/products/update` | product |
| `product.publish` | `POST /api/m2m/shop/products/publish` | product |
| `product.unpublish` | `POST /api/m2m/shop/products/unpublish` | product |
| `product.delete-draft` | `POST /api/m2m/shop/products/delete` | product |
| `price.create` | `POST /api/m2m/shop/products/prices` | product |
| `price.deactivate` | `POST /api/m2m/shop/products/prices/deactivate` | price |
| `stock.enable` | `POST /api/m2m/shop/products/stock/enable` | product |
| `stock.adjust` | `POST /api/m2m/shop/products/stock/adjust` | product |
| `stock.set-threshold` | `POST /api/m2m/shop/products/stock/threshold` | product |

## The credential

The owner creates the key in their own session, exactly like a direct key,
with `mode` set to `propose`:

```bash
pnpm --silent run cli api-key shop-management create Catalogue agent \
  --scope shop:catalog:read shop:catalog:write \
  --expires-at 2026-12-01T00:00:00.000Z --mode propose
```

The mode is fixed at creation; `direct` is the default and keeps the existing
behaviour. On a propose-mode key:

- read scopes grant the same reads as on a direct key;
- `shop:catalog:write` grants only `proposal:submit:catalog`, never
  `product:write`, `product:price:write` or `product:publish`;
- `shop:settings:write` grants only `proposal:submit:settings`, never
  `tenant:settings:write`; no settings operation exists yet, so the settings
  routes refuse the key;
- `shop:fulfilment:write` and `shop:integrations:write` cannot be granted:
  creation answers `400`;
- every propose-mode key holds `proposal:own:manage`, which reaches only the
  proposals that key made.

The key's capability list is always a defined array, so `authorize()` never
falls back to the owner's full authority for it.

## Route classes

Every shop route that writes declares one class for a propose-mode key in
`apps/server/src/shop-machine-auth.ts`; the server refuses to start when a
shop write route declares none, and a test pins the class of every registered
shop route. A direct-mode key is unaffected on every route.

| Class | Routes | A propose-mode key gets |
|---|---|---|
| `proposal` | the ten catalogue write routes above | `202` with a receipt; the live handler never runs |
| `refuse`, reason `not-in-release` | shop settings, branding and cover images, sales links | `403 forbidden` |
| `refuse`, reason `secret` | integration routes | `403 forbidden` |
| `refuse`, reason `side-effect` | order fulfilment and carrier shipment routes | `403 forbidden` |
| `proposal-management` | `/api/m2m/shop/proposals` routes | the key's own proposals; a direct-mode key gets `403` |

Reads (`GET`) behave as before for both modes. The order on a write route is
unchanged: authenticate the key and its issuer, apply the rate limit and the
scope, write the key history `request` row, then dispatch by class. A proposal
therefore leaves a `request` row in the [key history](shop-management-keys.md#key-history)
like any other keyed write.

## Receipts

The `202` answer of a proposal route, and every key-side read, carries the
key receipt:

```json
{
  "ok": true,
  "data": {
    "outcome": "proposed",
    "proposal": {
      "id": "…",
      "status": "pending",
      "operation": "product.update",
      "target": { "kind": "product", "id": "…" },
      "groupId": null,
      "createdAt": "2026-11-20T10:00:00.000Z",
      "expiresAt": "2026-12-20T10:00:00.000Z",
      "input": { "id": "…", "title": "Second edition" },
      "decisionNote": null,
      "failureCode": null
    }
  }
}
```

A receipt never contains the effect, a before value, a live label or the
deciding account, so a key with a write scope and no read scope cannot read
live state through a proposal. The owner view is separate and complete: it
adds the effect, the proposing key's name, id, issuer and state (`active`,
`expired`, `revoked`, `purged`), the decision and the event history.

The typed client returns a discriminated result for the ten catalogue
mutations: `{ outcome: 'applied', product }` (or `price`, `stock`,
`deleted`) for a direct-mode key and `{ outcome: 'proposed', proposal }` for a
propose-mode key; `isProposedChange(value)` narrows it. The keyed CLI
commands (`shop products|prices|stock …`) print the receipt and exit `0` on a
`202`.

## Routes

Key side, any scope of a propose-mode key:

| Route | Answer |
|---|---|
| `GET /api/m2m/shop/proposals?status=&cursor=&limit=` | `{ proposals: receipt[], nextCursor }`, newest first, this key's proposals only |
| `GET /api/m2m/shop/proposals/:id` | `{ proposal: receipt }`; another key's proposal is `404` |
| `POST /api/m2m/shop/proposals/:id/withdraw` | `{ proposal: receipt }` with status `withdrawn`; a settled proposal is `409` |

Owner session only (the verified owner in their own session: not while viewing
as a member, not an admin, never with an API key):

| Route | Answer |
|---|---|
| `GET /api/change-proposals?status=&cursor=&limit=` | `{ proposals: ownerView[], nextCursor }`, newest first |
| `GET /api/change-proposals/:id` | `{ proposal: ownerView + events }` |
| `POST /api/change-proposals/:id/reject` with `{ "note"?: string }` | `{ proposal: ownerView }` with status `rejected`; a settled proposal is `409` |

`status` is one of the statuses below, `limit` is 1–100 (default 50) and
`cursor` is the id of the last proposal of the previous page. A proposal of
another workspace is `404`.

CLI: the owner runs `proposals list [--status] [--cursor] [--limit]`,
`proposals show <id>` and `proposals reject <id> [--note <text>]`; the key runs
`shop proposals list|show|withdraw` with the key in the environment variable
named by `--api-key-env` (default `TOGETHER_SHOP_KEY`).

## Statuses

| Status | Meaning |
|---|---|
| `pending` | waiting for the owner |
| `rejected` | the owner rejected it; nothing was applied |
| `withdrawn` | the key withdrew it, or its key was revoked (note `key_revoked`) or purged (note `key_purged`) |
| `expired` | derived: still `pending` 30 days after creation; it can no longer be decided |
| `applied`, `stale`, `failed` | reserved for approval, not reachable yet |

Every transition appends an event (`proposed`, `rejected`, `withdrawn`,
`expired`, …) in the transaction that changes the status. A read never
writes: the `expired` event is recorded when a reject or a withdrawal meets
an expired proposal. Revoking or purging a key withdraws its pending proposals
in the same transaction as the key change. A key that simply expires leaves
its proposals decidable; the owner view shows the key state.

## Limits

Enforced in the transaction that stores the proposal; over a limit the key
gets `409 conflict` with the limit named in `error.details.changeProposalCap`:

| Limit | Value | `changeProposalCap` |
|---|---|---|
| Pending, unexpired proposals per key | 200 | `key_pending` |
| Pending, unexpired proposals per workspace | 1,000 | `workspace_pending` |
| Proposals created per key in 24 hours, any status | 500 | `key_daily` |
| Stored effect | 64 KiB | `effect_size` |

A decision note is at most 500 characters. The key's own rate limits (60
requests a minute, 10,000 a day) apply as on every shop route.

## Not yet available

- **Approve.** No proposal is applied in this release. Approval will run the
  stored command in one transaction with the target row locked, recompute the
  effect, apply it only when it equals the effect the owner saw, and otherwise
  mark the proposal `stale` (or `failed` with the domain error).
- **Sales links, settings, images.** Their write routes refuse a propose-mode
  key until their operations exist. Product covers and branding images will be
  uploaded to a private quarantine and published only on approval.
- **Groups.** Several proposals that belong together, approved all or
  nothing; the `change_proposal_groups` table exists but no route uses it.
- **Owner panel.** The owner decides through the session routes and the CLI;
  no panel page exists yet.
- **Retention.** Terminal proposals and their events are kept; a retention
  purge is a follow-up.

## Residual lost update

Approval will lock the target row and compare effects, so it can never apply
something different from what the owner saw. A live writer (an owner tab or a
direct-mode key) that read the row before the approval took its lock can still
overwrite the applied change afterwards. That lost update exists today between
any two writers of the same row; closing it needs a revision column and is out
of scope.
