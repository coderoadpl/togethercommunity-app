# Change proposals

A change proposal is a write that a machine asked for and the workspace owner
has not yet decided on. It comes from a [shop management key](shop-management-keys.md)
created in **propose mode**: such a key reads what its read scopes allow, and
every catalogue, sales-link and settings write it sends is stored as a
proposal instead of changing the live shop. The owner reads each proposal with
a field-level before/after and approves or rejects it. An approval applies
exactly the effect the owner saw, or applies nothing.

## Status

| Surface | Status |
|---|---|
| Propose-mode shop management keys (`mode: "propose"`) | Available |
| Proposals for the ten catalogue write routes | Available |
| Proposals for sales-link create, update and delete and the shop settings update | Available |
| Key-side list, read and withdraw (`/api/m2m/shop/proposals`) | Available |
| Owner-session list, read, approve and reject (`/api/change-proposals`) | Available |
| Withdrawal of pending proposals when their key is revoked or purged | Available |
| Typed client outcomes and CLI commands | Available |
| Images (product covers, branding), groups, owner panel | Not yet available |

## What a proposal is

A proposal stores two things:

- **The command**: a closed `operation` name and its `input`, parsed by the
  same strict schema as the live route, with every default filled in. The
  stored input is what an approval will run, never a re-read of the original
  request.
- **The effect**: what the command would change. It is computed by a dry run:
  the live use-case runs inside one database transaction, on the target row
  locked against concurrent writes (`FOR NO KEY UPDATE`, so a live stock
  write that inserts its event still proceeds), acting as the owner who issued
  the key, and the
  transaction is always rolled back. The effect is the field-level difference
  between the target before and after (`{ "title": { "before": "A", "after":
  "B" } }`), derived fields included, such as the published flag, the active
  prices or a VAT exemption basis taken from the settings. A stock adjustment
  is stored as a delta (`{ "onHand": { "delta": 5 } }`), never as an absolute
  balance.

The dry run never leaves a row, an event, an outbox message or a content
version behind, and object storage deletes that a live operation would make
are dropped with the rollback. Everything the dry run reads, the storage
credentials of a draft deletion included, is read through the transaction's
own connection; it never takes a second database connection. A domain error from the dry run is returned to
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
| `sales-link.create` | `POST /api/m2m/shop/sales-links` | a new sales link |
| `sales-link.update` | `POST /api/m2m/shop/sales-links/:id` | sales link |
| `sales-link.delete` | `DELETE /api/m2m/shop/sales-links/:id` | sales link |
| `settings.update` | `POST /api/m2m/shop/settings` | the shop settings |

A sales-link update carries the `expectedRevision` the key read, exactly as on
the live route, and its path id must equal the body id. A sales-link deletion
sends no body; its stored input is `{ "id": … }`. The sales-link effect
includes the link's `revision`, so a link changed after the proposal makes its
approval `stale`. A settings proposal covers exactly the settings fields a
shop management key may write (the same allow-list as the live route) and
never a secret; its effect includes the fields the settings rules rewrite,
such as the VAT rate cleared by a switch to VAT exemption.

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
- a write scope needs its read scope: `shop:catalog:write` needs
  `shop:catalog:read` and `shop:settings:write` needs `shop:settings:read`.
  Creation answers `400` without it, the database refuses such a row, and a
  proposal is refused (`403`, before any dry run) unless the key also holds
  the read capability of the operation's family (`product:read` for the
  catalogue, `tenant:settings:read` for the settings);
- `shop:catalog:write` grants only `proposal:submit:catalog`, never
  `product:write`, `product:price:write` or `product:publish`;
- `shop:settings:write` grants only `proposal:submit:settings`, never
  `tenant:settings:write`; the settings update becomes a proposal and the
  branding image routes refuse the key;
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
| `proposal` | the fourteen write routes above | `202` with a receipt; the live handler never runs |
| `refuse`, reason `not-in-release` | branding and product cover images | `403 forbidden` |
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
deciding account. Whether a proposal is accepted or refused still depends on
live state (a stock adjustment below zero is refused, a large before value
can hit the effect limit), which is why a write scope always comes with its
read scope: a propose-mode key learns nothing from a refused or accepted
proposal that it could not read with its read scope. The owner view is
separate and complete: it
adds the effect, the proposing key's name, id, issuer and state (`active`,
`expired`, `revoked`, `purged`), the decision and the event history.

The typed client returns a discriminated result for the ten catalogue
mutations and for `createSalesLink`, `updateSalesLink`, `deleteSalesLink` and
`updateSettings`: `{ outcome: 'applied', product }` (or `price`, `stock`,
`salesLink`, `settings`, `deleted`) for a direct-mode key and
`{ outcome: 'proposed', proposal }` for a propose-mode key;
`isProposedChange(value)` narrows it. The keyed CLI commands
(`shop products|prices|stock …`, `shop settings set`,
`shop sales-links create|update|delete`) print the receipt and exit `0` on a
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
| `POST /api/change-proposals/:id/approve` with `{}` | `{ proposal: ownerView }` with status `applied`, `stale` or `failed`; a settled or expired proposal is `409` |
| `POST /api/change-proposals/:id/reject` with `{ "note"?: string }` | `{ proposal: ownerView }` with status `rejected`; a settled proposal is `409` |

`status` is one of the statuses below, `limit` is 1–100 (default 50) and
`cursor` is the id of the last proposal of the previous page. A proposal of
another workspace is `404`.

CLI: the owner runs `proposals list [--status] [--cursor] [--limit]`,
`proposals show <id>`, `proposals approve <id>` and
`proposals reject <id> [--note <text>]`; the key runs
`shop proposals list|show|withdraw` with the key in the environment variable
named by `--api-key-env` (default `TOGETHER_SHOP_KEY`).

## Approval

The owner approves one proposal at a time. The approval runs in one database
transaction:

1. lock the proposal row while it is `pending` and unexpired;
2. lock the target row and read it again;
3. if a field the stored effect changes no longer holds the value the owner saw
   as "before", stop: the proposal is `stale`;
4. otherwise run the stored command, re-parsed by the live schema, through the
   live use-case as the approving owner, inside a savepoint;
5. read the target again and compute the effect; if it equals the stored
   effect, commit: the proposal is `applied`, and any effect outside the
   database (such as an object storage delete of a removed draft) runs after
   the commit;
6. if the effect differs, roll back the savepoint: the proposal is `stale`;
7. if the live use-case refuses the command, roll back the savepoint: the
   proposal is `failed`, with the error code and message stored.

The status change and its event (`applied`, `stale` or `apply_failed`) commit
in the same transaction as the live change, so the owner sees exactly one of
three outcomes and nothing in between. An infrastructure failure (a lost
connection, a database error) rolls everything back and leaves the proposal
`pending`; the owner can retry. So does a wait of more than 5 seconds for the
workspace lock that dry runs also take, answered `503 unavailable`. A repeated or concurrent approve, or an
approve after a reject or a withdrawal, finds no pending row and answers
`409 conflict` with the current status in `error.details.changeProposalStatus`.

| Outcome | Live state | What the proposer should do |
|---|---|---|
| `applied` | changed exactly as the effect showed | nothing; `appliedResourceId` names the created or changed resource |
| `stale` | unchanged | read the current state and propose the change again; the old proposal stays settled |
| `failed` | unchanged | read `failureCode` on the receipt, fix the cause (for example a stock level that would go below zero), then propose again |

**Stale** means the live state moved after the proposal was made: another
writer (the owner in the panel, a direct-mode key, a checkout) changed a field
the proposal changes, or running the command now would give a different
effect than the one the owner approved. Approval never applies a change the
owner did not see; the proposer has to propose again from the current state.

**Stock delta rule.** A stock adjustment is approved as a delta. Its approval
does not go stale because the balance moved (sales reserve and release stock
all the time): `{ "onHand": { "delta": 5 } }` adds five pieces to whatever is
on hand at approval. It goes stale only when stock tracking itself changed,
and fails when the delta would take the balance below zero.

Only the owner decides (`proposal:decide` is owner-only): the approval runs
the command with the approving owner's session, never with the proposing
key's scopes, and no key can approve anything.

## Statuses

| Status | Meaning |
|---|---|
| `pending` | waiting for the owner |
| `rejected` | the owner rejected it; nothing was applied |
| `withdrawn` | the key withdrew it, or its key was revoked (note `key_revoked`) or purged (note `key_purged`) |
| `expired` | derived: still `pending` 30 days after creation; it can no longer be decided |
| `applied` | the owner approved it and the change was applied as shown |
| `stale` | the owner approved it, the live state had changed, nothing was applied |
| `failed` | the owner approved it, the live use-case refused it, nothing was applied |

Every transition appends an event (`proposed`, `applied`, `stale`,
`apply_failed`, `rejected`, `withdrawn`, `expired`) in the transaction that
changes the status. A read never writes: the `expired` event is recorded when
an approve, a reject or a withdrawal meets an expired proposal. Revoking or purging a key withdraws its pending,
unexpired proposals in the same transaction as the key change; a proposal
already past its expiry stays `expired`. A key that simply expires leaves its
proposals decidable; the owner view shows the key state.

## Limits

The three count limits are checked read-only before the dry run, so a key at
a limit is answered at once, and again in the transaction that stores the
proposal, so two concurrent proposals cannot both take the last slot. Over a
limit the key gets `409 conflict` with the limit named in
`error.details.changeProposalCap`:

| Limit | Value | `changeProposalCap` |
|---|---|---|
| Pending, unexpired proposals per key | 200 | `key_pending` |
| Pending, unexpired proposals per workspace | 1,000 | `workspace_pending` |
| Proposals created per key in 24 hours, any status | 500 | `key_daily` |
| Stored effect | 1.25 MiB | `effect_size` |

The effect limit is larger than the largest change a valid product input can
describe (every length-limited text field at its maximum before and after,
the unlimited URL fields at a whole request body), so it only stops an effect
over a list that has no length limit, such as the active prices of a deleted
draft.

Dry runs and inserts of one workspace queue on a workspace lock. A request
that waits more than 5 seconds for it gets `503 unavailable` with a
`retry-after` header, and nothing is stored.

A decision note is at most 500 characters. The key's own rate limits (60
requests a minute, 10,000 a day) apply as on every shop route.

## Not yet available

- **Images.** The product cover and branding image routes refuse a
  propose-mode key. Images will be uploaded to a private quarantine and
  published only on approval.
- **Groups.** Several proposals that belong together, approved all or
  nothing; the `change_proposal_groups` table exists but no route uses it.
- **Owner panel.** The owner decides through the session routes and the CLI;
  no panel page exists yet.
- **Retention.** Terminal proposals and their events are kept; a retention
  purge is a follow-up.

## Residual lost update

Approval locks the target row and compares effects, so it never applies
something different from what the owner saw. A live writer (an owner tab or a
direct-mode key) that read the row before the approval took its lock can still
overwrite the applied change afterwards. That lost update exists today between
any two writers of the same row; closing it needs a revision column and is out
of scope.
