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
| Groups: item references, group dry run, all-or-nothing approval, key and owner routes and CLI ([Groups](#groups)) | Available |
| Images (product covers, branding), owner panel | Not yet available |

## What a proposal is

A proposal stores two things:

- **The command**: an `operation` name from the list below and its `input`,
  parsed by the same strict validator as the live route (an unknown key at any
  depth is refused), with every default filled in. The stored input is what an
  approval will run, never a re-read of the original request. The list of
  operations lives in the domain (`core/domain/change-proposal.ts`); the
  database checks only the shape of the name (a lowercase family, a dot, a
  lowercase action, hyphens allowed, at most 64 characters), so a later
  operation needs no migration.
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

The dry run executes the live use-case with the rights of the owner who issued
the key, inside a transaction that always rolls back. What a key may propose is
bounded by the operations registry (the ten operations below) and the
[route classes](#route-classes), not by the context of the dry run, which
carries the owner's identity and no capability list of the key.

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

A draft deletion has its own effect: it lists everything the deletion
destroys, not only the product fields. Besides the product fields it holds
every price of the product (active or not, with its id), every download file
(id, file name, size, status and version) and the stock (tracked or not, on
hand, reserved, low-stock threshold). Approval takes these rows with the
product row exclusively (`FOR UPDATE`), so no download, price or stock change
can slip in between the comparison and the deletion; a download uploaded or a
stock change made after the proposal makes its approval `stale`, and nothing is
deleted, in the database or in object storage.

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

A propose-mode key's stored hash is taken in a separate propose-mode hash
domain (a fixed label mixed into the secret before hashing); a direct-mode key
keeps the plain hash of its secret. The server accepts a key only through the
domain of its own mode and refuses any other match with `401 Invalid API key`.

### Rolling back

A release that predates migration `0163_change_proposals` ignores the `mode`
column and hashes the presented secret the plain way, so it finds no row for a
propose-mode key and answers `401 Invalid API key`: the key never gains live
write access there. Direct-mode keys keep working. Pending proposals stay in
their tables untouched and are visible again after rolling forward. No purge is
needed for safety; see the [key rollback](shop-management-keys.md#rollback).

Migration `0164_change_proposal_operations` replaces the list check on
`change_proposals.operation` with the shape check. Every row the earlier list
allowed has the new shape, so it validates without failing. Its locks on
`change_proposals`: dropping the old check and adding the new one `NOT VALID`
take `ACCESS EXCLUSIVE` and run in constant time; `VALIDATE CONSTRAINT` scans
the table once. The migrator runs every migration in one transaction, so the
`ACCESS EXCLUSIVE` lock is held until that transaction commits, scan included;
the table holds only proposals, so the scan is short.

Rolling back past this release to one that carries migration 0163 and only the
ten catalogue operations: migrations are not rolled back, and such a release
parses every row it reads with its closed list of ten operations. It throws on
a row with any other operation (`sales-link.*`, `settings.update`), so every
proposal read that meets such a row answers `500`: the owner list, read and
reject, and the key list, read and withdrawal (that release has no approve).
Nothing live changes and nothing is applied; key revocation and purge still
work, and new catalogue proposals are still stored. Before such a rollback,
count the rows the earlier release cannot read:

```sql
select count(*) from change_proposals
where operation not in ('product.create', 'product.update', 'product.publish',
  'product.unpublish', 'product.delete-draft', 'price.create', 'price.deactivate',
  'stock.enable', 'stock.adjust', 'stock.set-threshold');
```

When it is `0`, the rollback is safe; otherwise roll forward again to read
them. This release itself reads a row of an operation it does not know and
treats it as described under [Unknown operation](#approval).

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
      "appliedResourceId": null,
      "failureCode": null
    }
  }
}
```

After an approval, `appliedResourceId` names the created or changed resource
(the new product of a `product.create`, the new price of a `price.create`, the
new sales link of a `sales-link.create`; `null` for a settings change), so the
key can name it in a follow-up proposal. The key already reads that family, so
the id tells it nothing its read scope does not. A receipt never contains the
effect, a before value, a live label or the deciding account. Whether a proposal is accepted or refused still depends on
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
| `GET /api/m2m/shop/proposals?status=&groupId=&cursor=&limit=` | `{ proposals: receipt[], nextCursor }`, newest first, this key's proposals only |
| `GET /api/m2m/shop/proposals/:id` | `{ proposal: receipt }`; another key's proposal is `404` |
| `POST /api/m2m/shop/proposals/:id/withdraw` | `{ proposal: receipt }` with status `withdrawn`; a settled proposal is `409` |

Owner session only (the verified owner in their own session: not while viewing
as a member, not an admin, never with an API key):

| Route | Answer |
|---|---|
| `GET /api/change-proposals?status=&groupId=&cursor=&limit=` | `{ proposals: ownerView[], nextCursor }`, newest first |
| `GET /api/change-proposals/:id` | `{ proposal: ownerView + events }` |
| `POST /api/change-proposals/:id/approve` with `{}` | `{ proposal: ownerView }` with status `applied`, `stale` or `failed`; a settled or expired proposal is `409` |
| `POST /api/change-proposals/:id/reject` with `{ "note"?: string }` | `{ proposal: ownerView }` with status `rejected`; a settled proposal is `409` |

`status` is one of the statuses below, `groupId` keeps only the items of one
[group](#groups), `limit` is 1–100 (default 50) and `cursor` is the id of the
last proposal of the previous page. A proposal of another workspace is `404`.
The group routes are listed under [Groups](#groups).

CLI: the owner runs `proposals list [--status] [--group] [--cursor] [--limit]`,
`proposals show <id>`, `proposals approve <id>`,
`proposals reject <id> [--note <text>]` and
`proposals group show|approve|reject <id>`; the key runs
`shop proposals list|show|withdraw` and `shop proposals group create|show|withdraw`
with the key in the environment variable named by `--api-key-env` (default
`TOGETHER_SHOP_KEY`), and adds `--group <id>` to any proposing command.

## Approval

The owner approves one proposal at a time. The approval runs in one database
transaction:

1. lock the proposal row while it is `pending` and unexpired, then read the
   clock again: a proposal that expired while the approval waited for the lock
   is not applied; its expiry is recorded and the answer is `409` with status
   `expired`;
2. validate the stored command again, strictly: an operation this release does
   not know, or an input with a key the current validator does not know at any
   depth (a field retired since the proposal, a settings field outside the
   key's allow-list), makes the proposal `stale` without running anything;
3. lock the target row (for a draft deletion: the product, its prices,
   downloads and stock, exclusively), read the clock again with the same
   expiry rule, and read the target again;
4. if a field the stored effect changes no longer holds the value the owner saw
   as "before", stop: the proposal is `stale`;
5. otherwise run the stored command through the live use-case as the approving
   owner, inside a savepoint;
6. read the target again and compute the effect; if it equals the stored
   effect, commit: the proposal is `applied`, and any effect outside the
   database (such as an object storage delete of a removed draft) runs after
   the commit;
7. if the effect differs, roll back the savepoint: the proposal is `stale`;
8. if the live use-case refuses the command, roll back the savepoint: the
   proposal is `failed`, with the error code and message stored.

The decision time recorded on the proposal and its event is the time read
after the target lock, not the time the request arrived.

The status change and its event (`applied`, `stale` or `apply_failed`) commit
in the same transaction as the live change, so the owner sees exactly one of
three outcomes and nothing in between. An infrastructure failure (a lost
connection, a database error) rolls everything back and leaves the proposal
`pending`; the owner can retry. So does any lock wait that runs out (see
[Lock waits](#lock-waits)), answered `503 unavailable`. A repeated or concurrent approve, or an
approve after a reject or a withdrawal, finds no pending row and answers
`409 conflict` with the current status in `error.details.changeProposalStatus`.

| Outcome | Live state | What the proposer should do |
|---|---|---|
| `applied` | changed exactly as the effect showed | nothing; `appliedResourceId` on the receipt names the created or changed resource, to use in a follow-up proposal |
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

**Unknown operation.** A proposal row whose operation this release does not
know (written by a later release, read after rolling back) is still listed and
shown to the owner and to its key, with its operation name, input and effect.
It cannot be approved: approval marks it `stale` with the note "This release
does not know the operation …" on its `stale` event, and changes nothing. The
owner may also reject it, and its key may withdraw it.

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
over a list that has no length limit, such as the prices and download files of
a deleted draft.

A decision note is at most 500 characters. The key's own rate limits (60
requests a minute, 10,000 a day) apply as on every shop route.

## Lock waits

Dry runs and inserts of one workspace queue on a workspace lock. Every lock
wait after it, for the whole proposal transaction of a dry run or an approval,
is bounded too: the transaction keeps a 5-second `lock_timeout` for the
proposal row, the target rows, the rows the live use-case locks and the
workspace lock of the sales links. A wait that runs out aborts the whole
transaction; once it has rolled back, the request is answered `503
unavailable` with `retry-after: 5`, on the keyed write routes and on the owner
approve route alike. Nothing is stored or applied, and a proposal being
approved stays `pending`. A deadlock that the database detects inside the
transaction is answered the same way, busy, like a lock wait that ran out.

## Groups

A group is several proposals of one key that belong together and depend on
each other, for example a new product, its price, its stock, publishing it
and a sales link for it. Proposed one at a time, the later ones could not even
be validated: a price needs a product id that exists only after the owner
approves the product. In a group the owner approves or rejects them as one
unit, and the unit is applied completely or not at all; every item still
shows the owner a real before/after.

### Creating and joining

A propose-mode key creates a group with a title (1 to 500 characters):

```http
POST /api/m2m/shop/proposals/groups
x-api-key: <propose-mode key>
content-type: application/json

{ "title": "Launch the field guide" }
```

The answer is `201` with `{ group: groupReceipt }`. Every later proposal the
key sends with the header `x-proposal-group: <group id>` joins the group and
gets the next position, assigned atomically; items keep that order. The
proposal answer is the usual `202` receipt plus the `group` receipt. Only the
key that created a group may add to it, read it or withdraw it: for another
key or another workspace the group answers `404` exactly like an unknown id.
A malformed header (anything but letters, digits, `.`, `_` and `-`) is `400`.
A direct-mode key's writes ignore the header and apply live. A group is
*open* while every item is `pending` and unexpired, and an item can join only
an open group (`409` otherwise).

### References

An item may name a resource that an earlier item of the same group creates,
written as `$proposal:<proposal id>`, for example
`{ "productId": "$proposal:3f6c…" }` after a `product.create` item. A
reference stands only where the operation takes the id of that kind of
resource:

| Operation | Positions that accept a reference |
|---|---|
| `product.update`, `product.publish`, `product.unpublish` | `id` (a product) |
| `product.delete-draft`, `price.create`, `stock.enable`, `stock.adjust`, `stock.set-threshold` | `productId` (a product) |
| `price.deactivate` | `id` (a price) |
| `sales-link.create` | each entry of `productIds` (a product) |
| `sales-link.update` | `id` (a sales link), each entry of `productIds` (a product) |
| `sales-link.delete` | `id` (a sales link) |

Products are created by `product.create`, prices by `price.create` and sales
links by `sales-link.create`. A reference resolves only to an earlier item of
the same group, the same key and the same workspace whose operation creates
that kind of resource: never to a live id, never forward, never across
groups. Anything else answers `400` when the item is submitted: an unknown or
later item, an item of another kind, a malformed reference, and any string
starting with `$proposal` outside a position of the table (in a title, a
description, a nested field). A proposal outside a group keeps every value as
given; there a reference is just an id that does not exist. For a reference
in a path (`/api/m2m/shop/sales-links/:id`), percent-encode it
(`%24proposal%3A…`).

**Worked example.** The five-step launch, with the receipt id of each step
used by the next ones (`P` is the id of the first receipt):

| # | Request (with `x-proposal-group: G`) | Body |
|---|---|---|
| 1 | `POST /api/m2m/shop/products` | `{ "title": "Field guide", "slug": "field-guide", "type": "physical", "priceCents": 3900, "currency": "PLN" }` → receipt `P` |
| 2 | `POST /api/m2m/shop/products/prices` | `{ "productId": "$proposal:P", "kind": "one_time", "amountCents": 3900, "currency": "PLN" }` |
| 3 | `POST /api/m2m/shop/products/stock/enable` | `{ "productId": "$proposal:P", "onHand": 10, "lowStockThreshold": 2 }` |
| 4 | `POST /api/m2m/shop/products/publish` | `{ "id": "$proposal:P" }` |
| 5 | `POST /api/m2m/shop/sales-links` | `{ "slug": "field-guide-offer", "title": "Field guide", "heading": "The field guide", "productIds": ["$proposal:P"] }` |

Step 4 alone would be refused (a physical product needs an active one-time
price), and so it is when sent before step 2; in the group it is validated
against the price of step 2. With the CLI:

```bash
pnpm --silent run cli --tenant acme shop proposals group create --title 'Launch the field guide'
pnpm --silent run cli --tenant acme shop products create --title 'Field guide' --slug field-guide --type physical --price 39 --currency PLN --group G
pnpm --silent run cli --tenant acme shop prices add --product '$proposal:P' --kind one_time --price 39 --currency PLN --group G
pnpm --silent run cli --tenant acme shop stock enable '$proposal:P' --on-hand 10 --threshold 2 --group G
pnpm --silent run cli --tenant acme shop products publish '$proposal:P' --group G
pnpm --silent run cli --tenant acme shop sales-links create --json-file field-guide-offer.json --group G
```

Single quotes keep the shell from expanding `$proposal`. The owner approves the
group once; the approval creates the product, its price, its stock, publishes
it and creates the sales link in one transaction, and each item's
`appliedResourceId` then names the real id.

### Group dry run

Adding an item runs one transaction that always rolls back: the earlier items
of the group are applied in order, exactly as an approval would apply them
(strict re-validation, references resolved to the ids created in this same
transaction, the stale pre-check, the effect comparison), then the new item
runs and only its effect is kept. A price for a proposed product, or
publishing a product whose price is proposed earlier in the group, is
therefore validated and previewed against the state the group will have
produced. A refusal of the new item is returned to the key unchanged and
nothing is stored.

A `409` at submit with `changeProposalGroupItem` in `error.details` means an
**earlier** item no longer applies to the live state: someone changed a field
it changes since it was proposed, so the group can no longer be applied as
recorded and nothing is stored. The key withdraws the group and proposes it
again from the current state. A `409` with `changeProposalGroupStatus` means
the group is no longer open (decided, withdrawn or expired), and one with
`changeProposalCap` names a limit. The dry run leaves no row, event, outbox
message or content version behind, and object storage deletes wait for a
commit that never comes.

**Stable effects.** The ids an item creates differ between a dry run and the
approval. Wherever such an id appears in an effect, it is stored as the
creating item's reference, both when the effect is stored and when it is
recomputed at approval, so the two compare equal; because the reference
names the item, a reference moved to another item no longer matches.

### Approval as one unit

The owner reads the group, then sends the ordered list of item ids they were
shown:

```http
POST /api/change-proposals/groups/<group id>/approve
content-type: application/json

{ "itemIds": ["<item 1>", "<item 2>", "<item 3>", "<item 4>", "<item 5>"] }
```

When the list differs from the group's current items (an item was added after
the owner looked, or the order is different) the answer is `409`
(`changeProposalGroupItemIds` lists the current ones) and nothing is applied.
Otherwise one transaction locks the group row and its items, then applies
each item in order as the approving owner, with every step of a single
approval: strict re-validation, references resolved from the ids created
earlier in the transaction, target lock, stale pre-check, the live use-case,
the effect comparison.

| Outcome | Group status | Items | Live state |
|---|---|---|---|
| every item matches | `applied` | all `applied`, each with its `appliedResourceId` | changed exactly as the effects showed; post-commit effects run afterwards |
| one item is stale | `stale` | that item `stale`, every other item `stale` with a note naming it | unchanged |
| one item is refused by the live use-case | `failed` | that item `failed` with its failure code and message, every other item `stale` with a note naming it | unchanged |
| a lock wait runs out, a deadlock, an infrastructure failure | `open` | all still `pending` | unchanged; `503` with `retry-after` |

The note on the other items reads "Not applied: item *n* (*id*) of this group
could not be applied, so nothing in the group was changed". A repeated
approval answers `409` with `changeProposalGroupStatus` and every item's status
in `changeProposalStatuses`.

Target rows are locked in item order, one item after the other. Two groups
that touch the same rows in opposite orders can wait on each other; the
bounded lock wait and the database's deadlock detection end such a wait, and
the approval answers busy with nothing applied, so the owner retries.

### Other decisions

The owner rejects a whole group (every pending item, with one note) with
`POST /api/change-proposals/groups/:id/reject` `{ "note"?: string }`; the key
withdraws a whole group with `POST /api/m2m/shop/proposals/groups/:id/withdraw`,
and a group without items is deleted when its key withdraws it. An item of a
group cannot be approved, rejected or withdrawn on its own: the
single-proposal routes answer `409` with `changeProposalGroupId`. Revoking or
purging a key withdraws its open groups with its other pending proposals.

**Expiry.** Every item of a group expires with the group's first item (an
item added later takes that expiry), so a group is never half expired; an
empty group expires 30 days after it was created. Approve, reject and
withdraw record the `expired` event on every item of an expired group.

### What each side sees

| Route | Who | Answer |
|---|---|---|
| `POST /api/m2m/shop/proposals/groups` | the propose-mode key | `201` `{ group: groupReceipt }` |
| `GET /api/m2m/shop/proposals/groups/:id` | the key that created it | `{ group: groupReceipt }` |
| `POST /api/m2m/shop/proposals/groups/:id/withdraw` | the key that created it | `{ group: groupReceipt }` with status `withdrawn` |
| `GET /api/change-proposals/groups/:id` | the verified owner in their own session | `{ group: groupOwnerView }` |
| `POST /api/change-proposals/groups/:id/approve` | the verified owner | `{ group: groupOwnerView }` with status `applied`, `stale` or `failed` |
| `POST /api/change-proposals/groups/:id/reject` | the verified owner | `{ group: groupOwnerView }` with status `rejected` |

The key's group receipt has the id, title, derived status, creation and
expiry times and the ordered item receipts, which never contain an effect, a
before value or the deciding account. The owner view adds the key name, id,
issuer and state, and every item with its effect and events; the owner
proposal list carries `groupId`, `groupTitle` and `groupPosition` on every
item. The derived group status is one of `open`, `expired`, `applied`,
`rejected`, `withdrawn`, `stale`, `failed`. The group routes refuse the same
callers as the single routes: a direct-mode key gets `403` on the key routes,
and an admin, an impersonating owner, an unverified owner and every key are
refused on the owner routes.

### Limits

At most 50 items per group and 20 open groups per key; over a limit the
answer is `409` with `changeProposalCap` set to `group_items` or
`key_open_groups`. Every item counts against the proposal limits above. The
cost of the group dry runs grows with the group, which the item cap and the
key's rate limit bound.

## Not yet available

- **Images.** The product cover and branding image routes refuse a
  propose-mode key. Images will be uploaded to a private quarantine and
  published only on approval.
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
