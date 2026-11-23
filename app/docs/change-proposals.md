# Change proposals

A change proposal is a write that a machine asked for and the workspace owner
has not yet decided on. It comes from a [shop management key](shop-management-keys.md)
created in **propose mode**: such a key reads what its read scopes allow, and
every catalogue, sales-link and settings write it sends, the files of digital
products included, is stored as a proposal instead of changing the live shop.
The owner reads each proposal with
a field-level before/after and approves or rejects it. An approval applies
exactly the effect the owner saw, or applies nothing.

## Status

| Surface | Status |
|---|---|
| Propose-mode shop management keys (`mode: "propose"`) | Available |
| Proposals for the eleven catalogue write routes | Available |
| Proposals for sales-link create, update and delete and the shop settings update | Available |
| Key-side list, read and withdraw (`/api/m2m/shop/proposals`) | Available |
| Owner-session list, read, approve and reject (`/api/change-proposals`) | Available |
| Withdrawal of pending proposals when their key is revoked or purged | Available |
| Typed client outcomes and CLI commands | Available |
| Groups: item references, group dry run, all-or-nothing approval, key and owner routes and CLI ([Groups](#groups)) | Available |
| Owner view with live labels and issuer state, pending summary, owner notification ([Owner view](#owner-view)) | Available |
| Owner panel page `/panel/proposals` ([Owner panel](#owner-panel)) | Available |
| Images (product covers, branding): private upload, address checks, owner preview, publication on approval and cleanup ([Images](#images)) | Available |
| Download files of digital products: private staging, proposed attach, replacement and removal, owner download link, review and decision in the owner panel, release on decisions ([Download files](#download-files)) | Available |
| What a product grants: one shared check of courses, modules and lessons, proposed replacement of the whole list, course, module and lesson titles in the owner view, rows and confirmation in the owner panel ([Product access](#product-access)) | Available |

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
bounded by the operations registry and the
[route classes](#route-classes), not by the context of the dry run, which
carries the owner's identity and no capability list of the key. The registry
holds the eighteen operations below.

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
| `product.set-access` | `POST /api/m2m/shop/products/access` | product |
| `download.add` | `POST /api/m2m/shop/products/downloads` | product |
| `download.replace` | `POST /api/m2m/shop/products/downloads/replace` | product |
| `download.remove` | `POST /api/m2m/shop/products/downloads/remove` | product |

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
- `shop:catalog:write` grants only `proposal:submit:catalog` and
  `proposal:asset:upload`, never `product:write`, `product:price:write` or
  `product:publish`;
- `shop:settings:write` grants only `proposal:submit:settings` and
  `proposal:asset:upload`, never `tenant:settings:write`; the settings update
  becomes a proposal and the branding image routes upload into the key's
  private quarantine ([Images](#images));
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
shop route. A read route may declare the class `refuse` as well. A direct-mode
key is unaffected on every route.

| Class | Routes | A propose-mode key gets |
|---|---|---|
| `proposal` | the eighteen write routes above | `202` with a receipt; the live handler never runs |
| `direct` | branding and product cover image upload and completion; download file upload, completion, copy and discard (`POST /api/m2m/shop/downloads/upload`, `…/complete`, `…/copy`, `DELETE /api/m2m/shop/downloads/staged/:id`) | the handler runs; an image stays private until approval ([Images](#images)), and a staged file stays private and reaches buyers only through an approved proposal ([Download files](#download-files)) |
| `refuse`, reason `secret` | integration routes | `403 forbidden` |
| `refuse`, reason `side-effect` | order fulfilment and carrier shipment routes | `403 forbidden` |
| `proposal-management` | `/api/m2m/shop/proposals` routes | the key's own proposals; a direct-mode key gets `403` |

Reads (`GET`) behave as before for both modes: the staged download file list
(`GET /api/m2m/shop/downloads/staged`) lists the calling key's own staged
files, and a product's file list
(`GET /api/m2m/shop/products/:productId/downloads`) is an ordinary read.
The order on a write route is
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
new sales link of a `sales-link.create`, the attached file of a `download.add`
or `download.replace`, whose id is the staged file's id, and the product of a
`download.remove` or a `product.set-access`; `null` for a settings change), so the key can name it in a
follow-up proposal. The key already reads that family, so
the id tells it nothing its read scope does not. A receipt never contains the
effect, a before value, a live label or the deciding account. Whether a proposal is accepted or refused still depends on
live state (a stock adjustment below zero is refused, a large before value
can hit the effect limit), which is why a write scope always comes with its
read scope: a propose-mode key learns nothing from a refused or accepted
proposal that it could not read with its read scope, except for product access
lists: a refusal tells it whether a course id it sent is an active course of the
workspace and whether a module or lesson belongs to the course it named (see
[What the key learns](#product-access)). The owner view is
separate and complete: it
adds the effect, the proposing key's name, id, issuer and state (`active`,
`expired`, `revoked`, `purged`), the issuer's state, a live label of the
target, the decision with the deciding account and the event history (see
[Owner view](#owner-view)).

The typed client returns a discriminated result for the eleven catalogue
mutations (`setProductAccess` included), for `createSalesLink`, `updateSalesLink`, `deleteSalesLink` and
`updateSettings`, and for `addProductDownload`, `replaceProductDownload` and
`removeProductDownload`: `{ outcome: 'applied', product }` (or `price`,
`stock`, `salesLink`, `settings`, `asset`, `deleted`) for a direct-mode key,
except `setProductAccess`, which no direct-mode scope grants and which answers
such a key `403`, and `{ outcome: 'proposed', proposal }` for a propose-mode key;
`isProposedChange(value)` narrows it. The keyed CLI commands
(`shop products|prices|stock …`, `shop settings set`,
`shop sales-links create|update|delete`, `shop files upload|copy|remove`) print
the receipt and exit `0` on a `202`.

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
| `GET /api/change-proposals?status=&groupId=&cursor=&limit=` | `{ proposals: ownerView[], nextCursor, hasMore }`, newest first |
| `GET /api/change-proposals/summary` | `{ pending, pendingGroups, hasProposals }`: the pending, unexpired proposals of the workspace (grouped items included), the groups they belong to, and whether the workspace holds any proposal at all, whatever its status |
| `GET /api/change-proposals/:id` | `{ proposal: ownerView + events }` |
| `POST /api/change-proposals/:id/approve` with `{}` | `{ proposal: ownerView }` with status `applied`, `stale` or `failed`; a settled or expired proposal is `409` |
| `POST /api/change-proposals/:id/reject` with `{ "note"?: string }` | `{ proposal: ownerView }` with status `rejected`; a settled proposal is `409` |
| `GET /api/change-proposals/:id/files/:fileId` | `{ download: { url, expiresAt, fileName, sizeBytes } }`: a 60-second signed download of a file the pending proposal attaches ([Download files](#download-files)) |

`status` is one of the statuses below or `decided`, which keeps every
proposal that is no longer waiting for the owner (any status but `pending`,
an expired one included); `groupId` keeps only the items of one
[group](#groups), `limit` is 1–100 (default 50) and `cursor` is the id of the
last proposal of the previous page. `hasMore` says whether a next page exists
(`nextCursor` is then its cursor); the server reads one row past the page to
know it. The key-side list takes the same `status` values. A proposal of
another workspace is `404`.
The group routes are listed under [Groups](#groups).

CLI: the owner runs `proposals list [--status] [--group] [--cursor] [--limit]`,
`proposals show <id>`, `proposals approve <id>`,
`proposals reject <id> [--note <text>]`,
`proposals file <id> <file id> --out <path> [--force]` and
`proposals group show|approve|reject <id>`; the key runs
`shop proposals list|show|withdraw` and `shop proposals group create|show|withdraw`
with the key in the environment variable named by `--api-key-env` (default
`TOGETHER_SHOP_KEY`), and adds `--group <id>` to any proposing command.

## Owner view

Every owner list item, proposal and group item carries what a card needs, so
the panel reads one page and makes no further call per item:

| Field | Meaning |
|---|---|
| `operation`, `target` | what the proposal changes, with the target kind and id (a `$proposal:` reference inside a group) |
| `targetLabel` | the target's title read from live state at read time: the product title, the product title of a price, the sales link title; for a creation, the created resource once applied (for an applied `price.create`, the product of the created price, also when the product was a `$proposal:` reference in a group); `null` when the target does not exist (yet) and always `null` for a settings change, which the page names in the viewer's language |
| `targetPrice` | for a price target, and for an applied `price.create`, the live terms of that price as data: `kind`, `interval`, `intervalCount`, `amountCents`, `currency`, so a card tells a monthly from a yearly price of the same product; `null` otherwise |
| `effect`, `input` | the stored before/after and command |
| `groupId`, `groupTitle`, `groupPosition` | the group, when the proposal belongs to one |
| `proposedBy` | `keyId`, `keyName`, `keyState`, `issuerUserId`, `issuerEmail`, `issuerIsVerifiedOwner` (whether that account is still a verified owner of the workspace, the check a key request makes) and `issuerIsFormerTeamMember` |
| `createdAt`, `expiresAt`, `status` | the times and the derived status |
| `decidedAt`, `decidedByUserId`, `decidedByEmail`, `decidedByIsFormerTeamMember`, `decisionNote`, `failureCode`, `failureMessage`, `appliedResourceId` | the decision of a settled proposal |
| `accessLabels` | only on a `product.set-access`, absent on every other proposal: `{ courses, modules, lessons, archivedCourses? }`; the first three are each a list of `{ id, title }` for every course, module (named in `moduleIds` or `excludedModuleIds`) and lesson id of the access lists before and after, read from live state at read time; `title` is `null` for an id that no longer names a course, module or lesson of the workspace; `archivedCourses`, present only when one is, lists the ids of the archived courses of either list ([Product access](#product-access)) |
| `proposedFiles` | only on a `download.add` or `download.replace`, absent on every other proposal: `[{ id, available, copiedFrom }]` for the staged file it attaches, read at read time: `available` says whether the proposal still holds that staged file, and `copiedFrom` is `{ productId, productTitle, versionNumber }` for a server-side copy (`productTitle` `null` when that product is gone), `null` for an upload or once the staged file is gone ([Download files](#download-files)) |

`proposedFiles` is a key that a panel page or a CLI built from a release before
this one does not know, and those clients parse these answers with a strict
schema: once a file proposal exists, a list page that holds it, its show and
the group that holds it fail to parse there. A panel tab loaded before the
deploy shows its error state until it is reloaded, and an earlier CLI reports
the parse failure until it is updated; the server and the stored data are not
affected. This is accepted and not worked around
([Rolling back](#download-files) under Download files). `accessLabels` is such
a key too, with the same consequence once a `product.set-access` proposal
exists ([Product access](#product-access)).

An e-mail (`issuerEmail`, `decidedByEmail`) is returned only for an account
that still holds a staff grant in this workspace, direct or derived from the
organisation that manages it. For any other account, a removed team member or
a deleted account, the e-mail is `null` and `issuerIsFormerTeamMember` or
`decidedByIsFormerTeamMember` is `true`, so the page can say "former team
member" without disclosing the address. The reader of those accounts returns
only accounts that hold such a grant, and the owner view checks the grant
again. Ownership follows the same effective grant as the owner session: an
owner derived from the organisation counts as an owner. The accounts and grants of every person on a page are read in one
query, whatever the page size.

The group owner view carries the same `issuerEmail`, `issuerIsVerifiedOwner`
and `issuerIsFormerTeamMember` on its `proposedBy`. The label and the price
are for display only: approval never reads them, and they can differ from the
effect's "before" when the live state moved, which is exactly what a stale
approval reports. None of these fields is ever part of a key receipt.

**Owner notification.** When a propose-mode key submits a proposal, every
owner of the workspace gets an in-app notification of kind `change-proposal`:
the direct owners and the owners derived from the active organisation that
manages the workspace, by the same effective grant the owner session checks.
Its payload carries its own typed field, `changeProposal: { keyName, groupId,
groupTitle }`, with the key name and, for a group, the group id and title. The
community fields repeat them, the key name in `authorDisplay` and the group in
`contextId` and `snippet`, because the release before the typed field reads
only those (Rolling back under [Images](#images)). A notification stored before
the typed field existed has only the community fields;
`changeProposalNotificationFacts` in `core/domain` reads the typed field when
it is there and the community fields otherwise, so such a notification stays
readable. There is at most one unread notification per
owner and key: the notification's source key is `change-proposal:<key id>`,
and the unique source key per recipient makes the insert atomic, so a second
proposal while it is unread adds nothing; once the owner read it, the next
proposal makes it unread again with the new time and a new notification id.
The new id makes every occurrence its own: a late "mark read" of the earlier
occurrence (from another tab or device) finds no row and cannot clear the new
one. A group makes a read notification unread again only when its first item
is stored, never for later items.

Every stored proposal, every group item included, sends each owner a realtime
event of kind `change-proposal`, also when nothing was written because the
owner's notification for that key is still unread (or, for a later group item,
already read): the event then names that existing notification, which stays as
it is. So an open panel refreshes its badge, its list and a group card for
every new proposal without a second unread notification. The notification
stream's `notification` frame carries the id and the kind, live and on a
`Last-Event-ID` replay (`{"id":"…","kind":"change-proposal"}`), so the page
can refresh its pending count on that kind alone.

It is written right after the proposal committed, not in the proposal
transaction, in one short transaction of its own that looks up the owners and
writes or reads their notifications. That transaction keeps a
transaction-local `lock_timeout` and `statement_timeout` of 500 ms (the
`notificationMs` bound, injectable like the other proposal bounds) on each of
its statements. The key's `202` waits for the notification at most that bound
in all, the wait for a database connection included: past it, the submission
logs that the notification passed its deadline and answers, and the bell entry
is not signalled live (no realtime event is published for it). The entry is
not dropped: the notification transaction is not cancelled, its own bounds end
it soon after, and when its write completes the entry appears on the owner's
next bell refresh. A bound that runs out
inside the transaction rolls the notification back and is logged; a failure to
write it is logged too, also when it comes after the deadline. None of these
ever fails or changes the submission, which always answers its committed
receipt. No migration is needed: the kind lives in the existing text
column, the typed field in the existing JSON payload column, and the existing
unique index carries the de-duplication.

## Owner panel

The workspace owner reviews and decides proposals on one page,
`/panel/proposals`, reached from **Proposals** in the Offer group of the panel
navigation and from the bell notification of kind `change-proposal`. The
address always works for the owner, whether or not the workspace has
proposals. The navigation entry is shown to the owner when the
[summary](#routes) says the workspace has proposals (`hasProposals`, any status,
a decided or expired one included), and while the page itself is open; a
workspace that has never received a proposal shows no entry. Its badge shows
the number of pending changes and appears only when something is pending. The
panel remembers the last `hasProposals` answer per workspace in the browser
(`together-has-proposals-<workspace id>` in local storage) and renders the
entry from it until the summary answers and when the summary fails, so the
entry does not appear late and shift the navigation on every page view; when
storage is unavailable the entry follows the summary alone. An admin never sees
the entry; one who opens the address sees an "owner only" page, and the panel
never sends them the owner routes. When the notification stream delivers a
`notification` frame of kind `change-proposal`, the panel refreshes the pending
summary and the proposal lists, so the entry appears when the first proposal
arrives. When the stream is unavailable and the bell falls back to polling, the
summary is polled at the same 30-second interval, and a change in its counts
refreshes the proposal lists.

The page follows the server's gate. An owner whose e-mail is not verified sees
"verify your e-mail to decide" with a link to the account page, and an owner
viewing the community as a member sees "leave the member view"; neither gets a
Retry that cannot succeed, and the summary is not requested for either, so
their navigation entry follows the remembered answer alone.

**Waiting for you** lists the pending proposals oldest first: one card per
group and one card per single proposal. A card names the change in plain words
("New product", "Stock: add or remove pieces", "Shop settings"), the live label
of what it touches, the proposing key, when it was proposed and when it
expires, and a warning line when the key is revoked, purged or expired, when
the account that issued it is no longer a verified owner, or when that account
is no longer on the team. A price target says which price it is, from the
structured price facts ("Studio Club: PLN 49.00 per month"), on the card, in the
confirmation and in history. A target that no longer exists says so; "not
created yet" is kept for a target that is still to be created or is a
reference inside a group. A group title is the key's text: it is shown under a
line that attributes it to the key and never appears in a sentence the
application speaks in its own voice (the headings, the confirmation, the
settled notice, history), which use the count and fixed wording instead.
Every piece of text written by a key or a person that the page shows (the group
title, the key name, product titles and references inside sentences, a stock
reason, a decision comment, field values) sits in its own `<bdi>` element, so
quotes or right-to-left control characters in it cannot reorder the sentence
around it.

Every changed field of an existing record is one row with a readable label and
the value now and after approval, stacked under the label on narrow screens;
the rows share the component of the course version preview. A new record (a new
product, sales link or price) is one framed definition list under a single
caption, "Will be created with:", with label and value side by side on wide
screens and stacked on narrow ones; a new price shows its terms there as one
line ("PLN 490.00 per year"), on its own card and as a group step; a deleted
record shows only the current value. Money is formatted with its currency, booleans as words, lists as
lists, and every enumerated value (product type, visibility, sales channel,
delivery method, parcel size, price kind and interval, VAT rate and mode,
exemption basis, invoicing provider, KSeF submission mode, invoicing scope,
default language) by the label the products, prices and settings screens use;
an unknown value falls back to its raw text. Long text is collapsed behind
"Show more", except when the collapsed beginnings of the two sides are the
same, where it starts expanded so the difference is visible. An empty value
says so. A stock adjustment shows the delta ("+50 pieces"), its reason (a
return is named as such) and the balance on hand now as context, never a final
balance. An image address is shown as an image only when it is a same-origin
public asset path (`/api/public/assets/…`); any other address is text, and an
image that fails to load is replaced by its address and a "could not be shown"
note. The image a pending proposal proposes under its digest is the exception:
it is loaded only through the owner preview, and an SVG is offered as a
download instead (see [Images](#images)). Inside a group, a `$proposal:` reference is shown as "the product from
step 1" with that step's title. A field the page does not know is shown with
its raw name and its value as text, and a proposal of an operation the page
does not know is shown with the notice "This version of the app cannot apply
this kind of change, so it can only be rejected here." and cannot be approved
from the page. Every operation the server can store and apply has its own
title and is approved from the page, the three download file operations
included ("New download file", "New version of a download file", "Remove a
download file"); their file rows, download and confirmation are described under
[Download files](#download-files). A change of what a product grants ("What a
product grants") shows its two access lists in words; its row and confirmation
are described under [Product access](#product-access).

A single proposal has **Approve** and **Reject**; a group has **Approve all N
changes** ("Approve the change" for a group of one) and **Reject group**.
Approve asks for one confirmation that repeats what will happen, built from
the same data as the card: the target and the essence ("Creator Workbook
(print): 50 pieces will be added to stock.", "The product “Field Guide (print)”
will be published.", "3 fields of “Field Guide (print)” will change.", "Stock of
“Field Guide (print)” will be tracked from now on, starting at 40 pieces on
hand, with the low-stock alert level at 5."). "Nothing else changes." follows
only a sentence that names every changed field of the proposal; when the
sentence leaves fields unnamed, the confirmation says how many other fields
change instead ("2 other fields will change too."). A group's confirmation
reads "All 5 changes will be applied together, or none.". When the proposal,
or any item of the group, carries a proposed image under its digest (the
images the card loads through the owner preview), the confirmation adds one
more sentence, counted per distinct image: approving makes the proposed image
public at the address shown, and if it no longer exists nothing is changed (for
a group: none of the changes is applied). A file proposal, alone or as a group
item, adds the sentences described under [Download files](#download-files),
and a product access proposal, alone or as a group item, the sentence described
under [Product access](#product-access).
Reject opens a
dialog with an optional comment that is shown to the proposer.

The group card reads the group itself (`GET /api/change-proposals/groups/:id`).
When the approve dialog opens, the card saves the ordered item ids rendered at
that moment (by position, whatever order the server served them in) and the
approval sends exactly that saved list. While the group is refetching, the
confirm button is disabled. Whenever a refetch (window focus, a list refresh, a
realtime notification) changes the id list compared with what the owner last
acknowledged, the dialog closes and approving needs a fresh click. The card
says "this group changed in the meantime and nothing was applied" when a
dialog was open or the server answered that the items changed (nothing is
applied then), and only "this group changed while you were looking at it" when
no dialog was open, since nothing was attempted. An open dialog also closes
when a refetch shows the group is no longer open (expired, withdrawn or
decided elsewhere); the card then shows that status without the buttons. A single
proposal needs no such step: its effect is fixed when it is proposed, so a
refetch cannot change what the owner approves.

While a request runs the buttons are disabled, and a busy answer (`503`) tells
the owner to try again in a moment without changing anything. After a decision
a toast reports the outcome and the lists refresh; a `stale` or `failed`
approval stays on the page as an explained notice until it is dismissed, and
the proposal moves to **History**. A `stale` approval is explained as "the
shop changed; the proposer can send it again", except when an item that
attaches an image ended stale because the image is no longer available: the
panel then reads that item's events and, finding the note code
`image_unavailable`, says that the proposed image is no longer available,
nothing was changed, and it has to be uploaded and proposed again. An item that
attaches a file is read the same way for the note code `file_unavailable`
([Download files](#download-files)). "Show more proposals" appends the next page
to the same list (settled notices and open dialogs stay) and moves focus to the
first new card. The full-page error appears only when nothing has loaded yet: a
next page that fails keeps the list and shows an inline error with a Retry of
that page, and a background refresh that fails keeps the list, the open dialog
and the notices as they were.

**History** asks the server for the `decided` proposals, 50 per page, with
their status, who decided and when (or "a former team member"), the decision
comment and, on expand, the same field rows and the event timeline; a `stale`
proposal that attaches an image reads its events too and, when the note code
is `image_unavailable`, shows the image line above in the row, labels its
status "Not applied: image no longer available" instead of "the shop changed",
and its timeline entry "Not applied: the proposed image was no longer
available" without repeating the line or showing the note code; the other
items of its group keep the generic label; a proposal that attaches a file is
labelled the same way for `file_unavailable` ([Download files](#download-files)); an empty
page shows the empty state, and "Show details" sits on the title row. Nothing
on the page updates live data optimistically: every change on screen comes
from a server answer. Headings inside cards follow the page outline without
skipped levels, and the application sets `<html lang>` to the active language.

The page is in Storybook as `Pages/PanelProposals` (a group of five items, a
stock delta and a settings change) and `Pages/PanelProposalsHistory`, and its
field rows as `Panel/ProposalChanges`, including a proposed image (loaded and
failed, in English and Polish) and a proposed SVG awaiting approval. Storybook
serves a small cover image at the same-origin asset path the fixtures use; it
has no owner preview route, so its fixture API answers the owner preview
address of two known story digests itself, with a small inline image for the
loaded story and an unreadable one for the failed story. File proposals are in
`Panel/ProposalChanges` too (an uploaded file, a copied file, a new version, a
removal that leaves an earlier version current, a removal of the product's only
file and the gone state of **Download file**, each in English and Polish),
in `Pages/PanelProposalFiles` (a group that creates a digital product, adds its
file, adds a price and publishes it, next to a single file proposal; English on
desktop and mobile, Polish on desktop) and in `Pages/PanelProposalFilesHistory`
(an approval that ended stale because its file was no longer available, with
its timeline open). Storybook has no owner link route: its fixture API answers
the link of the gone story's file with `404`, and the link of any other story
file fails, so its row says the download could not be started. Product access
proposals are in `Panel/ProposalChanges` as well (a list that grants a course
without one module, a module and two lessons; a list that names an archived
course, a course and a lesson that no longer exist; a list that lifts the
exclusion of a module; and a list cleared to nothing,
each in English and Polish), and in `Pages/PanelProposalAccess` (those four
next to a group that creates a product and sets what it grants, and sets what
an existing product grants; English and Polish, desktop and mobile). These
stories have no committed golden.

## Approval

The owner approves one proposal at a time. The approval runs in one database
transaction:

1. lock the proposal row while it is `pending` and unexpired, then read the
   clock again: a proposal that expired while the approval waited for the lock
   is not applied; its expiry is recorded and the answer is `409` with status
   `expired`. Each image the proposal attaches is then taken and verified (see
   [Images](#images)), and so is each staged file it attaches (see
   [Download files](#download-files)): one that is no longer available makes
   the proposal `stale` without running anything;
2. validate the stored command again, strictly: an operation this release does
   not know, or an input with a key the current validator does not know at any
   depth (a field retired since the proposal, a settings field outside the
   key's allow-list), makes the proposal `stale` without running anything;
3. lock the target row (for a draft deletion: the product, its prices,
   downloads and stock, exclusively; for a product access change: first the
   courses its new list names, then the product, see
   [Product access](#product-access)), read the clock again with the same
   expiry rule, and read the target again;
4. if a field the stored effect changes no longer holds the value the owner saw
   as "before", stop: the proposal is `stale`;
5. otherwise run the stored command through the live use-case as the approving
   owner, inside a savepoint;
6. read the target again and compute the effect; if it equals the stored
   effect, commit: the proposal is `applied`, and any effect outside the
   database (such as an object storage delete of a removed draft) runs after
   the commit; the one exception is publishing an attached image, which
   happens just before the commit (see [Images](#images));
7. if the effect differs, roll back the savepoint: the proposal is `stale`;
8. if the live use-case refuses the command itself, roll back the savepoint:
   the proposal is `failed`, with the error code and message stored;
9. if the live use-case answers any other error, roll back the whole
   transaction: the proposal stays `pending` and the approval is answered with
   that error.

A refusal of the command itself is an error whose code describes the request
against the current state: `not_found`, `validation`, `conflict`,
`slug_reserved`, `invoice_exemption_basis_missing`, `shipping_required`,
`sold_out`, `fulfilment_conflict`, `shipx_rejected`, `workspace_quota_exceeded`,
`organization_managed`, `feed_cursor_reset`, `not_consented`, `suppressed`,
`unsubscribed` and `pending_confirmation`. Every other code describes the
caller, the configuration or the infrastructure (`internal`, `unavailable`,
`rate_limited`, `integration_unavailable`, `integration_auth`,
`integration_not_configured`, `shipx_unavailable`, `ses_not_configured`,
`broadcasts_disabled`, `transactional_platform_cap_reached`, `unauthorized`,
`invalid_credentials`, `forbidden`, `banned`, `impersonation_read_only`,
`tenant_not_found`) and can pass, so it never settles a proposal. The
classification is `describesTheRequest` in `core/domain/errors.ts`; a new error
code cannot be added without classifying it.

The decision time recorded on the proposal and its event is the time read
after the target lock, not the time the request arrived. An approval that ends
`stale` because an attached image or file is no longer available is decided
before any target lock: its decision time is the time read when that was found.

The status change and its event (`applied`, `stale` or `apply_failed`) commit
in the same transaction as the live change, so the owner sees exactly one of
three outcomes and nothing in between. An infrastructure failure (a lost
connection, a database error) rolls everything back and leaves the proposal
`pending`; the owner can retry. So does an error of the live use-case that is
not a refusal of the command (step 9), and any lock wait that runs out (see
[Lock waits](#lock-waits)), answered `503 unavailable`. A repeated or concurrent approve, or an
approve after a reject or a withdrawal, finds no pending row and answers
`409 conflict` with the current status in `error.details.changeProposalStatus`.

| Outcome | Live state | What the proposer should do |
|---|---|---|
| `applied` | changed exactly as the effect showed | nothing; `appliedResourceId` on the receipt names the created or changed resource, to use in a follow-up proposal |
| `stale` | unchanged | read the current state and propose the change again, uploading again an attached image or file that is no longer available; the old proposal stays settled |
| `failed` | unchanged | read `failureCode` on the receipt, fix the cause (for example a stock level that would go below zero), then propose again |

**Stale** means the live state moved after the proposal was made: another
writer (the owner in the panel, a direct-mode key, a checkout) changed a field
the proposal changes, or running the command now would give a different
effect than the one the owner approved. It also means an image or a staged file
the proposal attaches is no longer available (see [Images](#images) and
[Download files](#download-files)), even when the live state is unchanged; the
key then has to upload the image or stage the file again before it proposes
again. Approval never applies a change the
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
| `stale` | the owner approved it, the live state had changed or an attached image or file was no longer available, nothing was applied |
| `failed` | the owner approved it, the live use-case refused it, nothing was applied |

Every transition appends an event (`proposed`, `applied`, `stale`,
`apply_failed`, `rejected`, `withdrawn`, `expired`) in the transaction that
changes the status. A read never writes: the `expired` event is recorded when
an approve, a reject or a withdrawal meets an expired proposal. A reject and a
withdrawal lock the proposal row first and only then read the clock, exactly
like an approval: a proposal that expired while they waited for the lock is
not decided, its expiry is recorded and the answer is `409` with status
`expired`; otherwise the decision time is the time read after the lock. Revoking or purging a key withdraws its pending,
unexpired proposals and deletes its empty groups in the same transaction as
the key change; a proposal already past its expiry stays `expired`. A key that simply expires leaves its
proposals decidable; the owner view shows the key state and whether the
issuing account is still a verified owner.

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
requests a minute, 10,000 a day) apply as on every shop route. The images a
key holds for approval have two limits of their own, checked when an upload
is completed, in the same transaction that records it, and the uploads it
starts a third, checked when an upload is started (see [Images](#images)).
The first two count every image of the key whose object the application has
not deleted yet: a released image counts until its object is deleted and its
row removed, so a storage that refuses deletes cannot grow a key's quarantine
past them:

| Limit | Value | `changeProposalCap` |
|---|---|---|
| Images awaiting approval per key | 100 | `key_quarantined_images` |
| Bytes of images awaiting approval per key | 50 MiB | `key_quarantined_bytes` |
| Image uploads started per key in 15 minutes, completed or not | 60 | `key_image_uploads` |

A propose-mode key stages download files under the same limits as a
direct-mode key ([Download files](shop-management-keys.md#download-files)), and
each staged file is held by at most one pending, unexpired proposal
([Download files](#download-files)).

## Lock waits

Dry runs and inserts of one workspace queue on a workspace lock. Every lock
wait after it, for the whole proposal transaction of a dry run or an approval,
is bounded too: the transaction keeps a 5-second `lock_timeout` for the
proposal row, the target rows, the rows the live use-case locks and the
workspace lock of the sales links. The same 5-second bound covers every
statement of the shorter proposal writes that run on their own: storing a
proposal or a group item (after the workspace lock), a reject, a withdrawal,
recording an expiry and deleting an empty group. A wait that runs out aborts
the whole transaction; once it has rolled back, the request is answered `503
unavailable` with `retry-after: 5`, on the keyed write, withdraw and group
routes and on the owner approve and reject routes alike. Nothing is stored or
applied, and a proposal being decided stays `pending`. A deadlock that the
database detects inside the transaction is answered the same way, busy, like a
lock wait that ran out.

The owner notification that follows a stored proposal has its own, shorter
bound (500 ms for each lock wait and statement, and 500 ms in all for the
submission's wait, see [Owner view](#owner-view)); running out of it never
answers busy, because the proposal is already stored.

**Statement time.** A dry run and an approval also bound the time of each
statement with a transaction-local `statement_timeout`: 2 seconds in a dry run
and 5 seconds in an approval. A statement that runs longer is cancelled, the
transaction rolls back and the answer is the same `503` busy answer. Each
statement of a 49-item group dry run takes milliseconds on a development
database, so the bounds stop only a database that is overloaded or stuck, not
a large group; the measured times are in the Groups limits below.

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
| `product.update`, `product.publish`, `product.unpublish`, `product.set-access` | `id` (a product) |
| `product.delete-draft`, `price.create`, `stock.enable`, `stock.adjust`, `stock.set-threshold` | `productId` (a product) |
| `price.deactivate` | `id` (a price) |
| `sales-link.create` | each entry of `productIds` (a product) |
| `sales-link.update` | `id` (a sales link), each entry of `productIds` (a product) |
| `sales-link.delete` | `id` (a sales link) |
| `download.add`, `download.replace`, `download.remove` | `productId` (a product) |

Products are created by `product.create`, prices by `price.create` and sales
links by `sales-link.create`. A file operation creates nothing a later item
names: the attached file's id is the staged file's id, known when it is
proposed. A reference resolves only to an earlier item of
the same group, the same key and the same workspace whose operation creates
that kind of resource: never to a live id, never forward, never across
groups. Anything else answers `400` when the item is submitted: an unknown or
later item, an item of another kind, a malformed reference, and any string
starting with `$proposal` outside a position of the table (in a title, a
description, a nested field). That last rule exists because a reference must
never be mistaken for content: the stored effects write every id the group
creates in its reference form, so a text that looked like a reference could be
read as one, or a real reference as text. A proposal outside a group keeps
every value as given; there a reference is just an id that does not exist. For a reference
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

Adding an item runs one transaction that always rolls back. It first reads the
group again: when the group was decided, withdrawn or expired, or another item
joined, while the submit waited for its locks, the answer is `409` with
`changeProposalGroupStatus` and nothing runs. Then the earlier items
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
again from the current state. An earlier item whose replay meets an error that
is not a refusal of that item answers that error instead, and the key may
retry. A `409` with `changeProposalGroupStatus` means
the group is no longer open (decided, withdrawn or expired), and one with
`changeProposalCap` names a limit. The dry run leaves no row, event, outbox
message or content version behind, and object storage deletes wait for a
commit that never comes.

**One dry run per group.** At most one dry run of a group runs at a time: a
submit takes a lock of its group before the workspace lock, waits for it at
most 5 seconds and otherwise answers `503` busy with `retry-after: 5`. A key
that sends the items of one group in parallel gets busy answers instead of
holding the workspace lock with several long replays.

**Stable effects.** The ids an item creates differ between a dry run and the
approval. Wherever such an id appears in an effect, it is stored as the
creating item's reference, both when the effect is stored and when it is
recomputed at approval, so the two compare equal; because the reference
names the item, a reference moved to another item no longer matches. Lists
without a meaningful order (the prices and download files of a deleted draft)
are sorted by the id each entry carries after that replacement, so ids that
sort differently at approval do not reorder them; a list whose order means
something (the products of a sales link) keeps its order.

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

**Items digest.** A client that shows the group and approves later carries
what the owner reviewed as a short digest: the first 16 hexadecimal characters
of the SHA-256 of the ordered item ids joined by new lines
(`changeProposalGroupItemsDigest` in `core/domain`, exported through
`core/client`; it holds no secret). The owner CLI prints it:
`proposals group show <id>` prints the items, `items digest: <digest>` and the
exact command `together proposals group approve <id> --items-digest <digest>`
(with `--json`, the fields `itemsDigest` and `approveCommand` beside `group`).
`proposals group approve <id> --items-digest <digest>` requires the digest,
reads the group, and when the current items give another digest prints them
with their new digest and exits `6`, the conflict exit code, without sending
anything; when it matches, it sends exactly those item ids, so the server's
check above protects the owner as well.
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
| the live use-case answers an error that is not a refusal of the item (see [Approval](#approval)) | `open` | all still `pending` | unchanged; answered with that error |
| a lock wait or a statement runs out of time, a deadlock | `open` | all still `pending` | unchanged; `503` with `retry-after` |
| an infrastructure failure (a lost connection, a database error) | `open` | all still `pending` | unchanged; `500 internal`, the owner can retry |

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
purging a key withdraws its open groups with its other pending proposals and
deletes its empty groups, in the same transaction as the key change, exactly
as the key's own withdrawal of an empty group would.

A reject and a withdrawal lock the group and its items first and only then
read the clock, so a group that expired while they waited is not decided: the
expiry is recorded on every item and the answer is `409` with status
`expired`. A join reads the clock after the same locks and answers the group
conflict.

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
issuer, issuer state and key state, and every item with its effect and events; the owner
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
cost of the group dry runs grows with the group; the item cap, the key's rate
limit, the one-dry-run-per-group rule and the statement time bounds of
[Lock waits](#lock-waits) bound it.

Measured on a development PostgreSQL 16 (three runs, a mix of product
creation, a price, stock, a rename and publication of each new product, a
live stock adjustment and a sales link): submitting the 50th item, whose dry
run replays the 49 earlier ones, took 340 to 420 ms in all, and approving the
50-item group took 480 to 520 ms in all. The per-statement bounds (2 seconds
in a dry run, 5 seconds in an approval) are therefore several times the whole
replay and the whole approval, so no valid group reaches them; in a dry run
the 2-second statement bound also ends a row lock wait before the 5-second
`lock_timeout` would.

## Images

A propose-mode key can propose a new product cover and new branding images
(logo, dark logo, favicon, share image). Nothing it uploads is publicly
reachable until an owner approval of a proposal that attaches it writes the
public copy, which happens just before that approval commits. The
use-cases are in `core/server/usecases/change-proposal-images.ts`; the routes
are the shop image routes a direct-mode key uses, which are of route class
`direct` and branch on the key's mode.

| Who | Sees |
|---|---|
| The key | the address the image will have, `quarantined: true`, and its own receipts; never the quarantined bytes |
| The owners | the proposed image through the owner preview while the proposal is pending (the quarantined copy, or the published copy when the address is one a live field already shows), then the public image once approved |
| Everyone else | for a new image, nothing until an approval writes its public copy just before it commits; from that write the address answers with the bytes, and if that approval then does not end `applied`, until its withdrawal or the minute sweep deletes the copy again (below). An address a live field already shows is public already |

**Upload.** `POST /api/m2m/shop/image-assets/product-cover/upload` (scope
`shop:catalog:write`) and `POST /api/m2m/shop/image-assets/branding/upload`
(scope `shop:settings:write`) need `proposal:asset:upload` with the
submission capability of the family: `proposal:submit:catalog` for a product
cover, `proposal:submit:settings` for a branding image. They presign a `PUT` to
the private candidate prefix `image-asset-candidates/` like the live upload,
but the signature also covers `content-length` with the declared `sizeBytes`
(1 to 5 MiB), so the storage refuses a body of any other size, and answer
`servePath: null` with `quarantined: true`, because the address depends on the
bytes. Before it answers, each such upload start is recorded in
`change_proposal_image_uploads` (workspace, key, candidate key, creation
time); a key that already started 60 uploads in the last 15 minutes, the
lifetime of the presigned `PUT`, gets `409` with `key_image_uploads` (see
[Limits](#limits)). The minute sweep deletes the candidate object of every
record older than 20 minutes (the lifetime and a 5-minute margin), whether the
upload was completed or not, keeps the record with the time of that delete
(`first_deleted_at`), deletes the candidate once more 10 minutes later and only
then removes the record. Neither an upload that is never completed, nor a
second `PUT` through a still valid URL, nor a `PUT` the storage accepted before
the URL expired that finishes after the first delete stays in the bucket; the
last rests on the storage finishing or abandoning a write it accepted within
those 10 minutes. Only the key whose upload start is recorded for a candidate key can
complete it: another key of the workspace, whatever its mode, and an owner
session completing it through the live route get `404 not_found`, so a
candidate a propose-mode key started is never published without an approval
and never taken over by another key. Completing it (the matching `.../complete`
route) runs the live content checks (size and format; an upload
that fails them is deleted and answers the same validation error), then copies
the bytes to a private, content-addressed key of the key,
`image-asset-quarantine/<workspace>/<key id>/<kind>/<sha256>.<ext>`, deletes the
candidate and answers `{ url, quarantined: true }`, where `url` is the public
address the image will have once approved,
`/api/public/assets/<kind>/<sha256>.<ext>`. Nothing is written under the public
prefix `image-assets/`. The same bytes again give the same key; other bytes
can never replace it, because the digest is the name. Each quarantined image
is a row of `change_proposal_images` (workspace, key, kind, digest, extension,
size, creation time, release time), so the limits, the references and the
cleanup never depend on listing object storage. Under a lock of that key,
completion counts the key's limits (above) over all its rows, pending and
released ones included, and commits the row as pending (`pending_since`), or revives a
released row of the same image as pending; then it writes the quarantined
object and, under the lock again, marks the row written. A pending row counts
toward the limits but is invisible to the submit check, the approval and the
owner preview, and another completion of the same image answers
`503 unavailable` meanwhile. When the storage refuses the write (a `4xx`
answer), the row is rolled back. When the write ends without a definite answer
(no answer, a connection error, a server error), or the process dies before
the second commit, the row stays pending, and the minute sweep deletes its
object and the row once it has been pending for 10 minutes, on the assumption
that the storage finishes or abandons a write within that time. Either way the
candidate is deleted and the storage error is answered. Two concurrent
completions therefore cannot both take the last slot, and every quarantined
object a completion writes is accounted for by a counted row until the sweep
or a release has removed it.

**Attaching.** The key then proposes `product.update` with `coverUrl`,
`product.create` with `coverUrl`, or `settings.update` with `logoUrl`,
`logoDarkUrl`, `faviconUrl` or `ogImageUrl` set to that address, alone or in a
[group](#groups). Every address a propose-mode key sets in one of these five
image fields must be one of its own quarantined images of the kind the field
expects, or a same-origin path `/api/public/assets/<kind>/<file>` of that kind,
where `<file>` is a UUID or a SHA-256 digest with an extension the kind
accepts, that a live product cover or branding field of the workspace already
shows; clearing a field or leaving it unchanged is always allowed. Anything
else, a foreign URL, another key's or another workspace's quarantined image, an
image of another kind, is refused at submit with `400` and the validation
message of the live route, naming the field. The two checkout appearance
images, `checkoutAppearance.logoUrl` and `checkoutAppearance.iconUrl`, cannot
be proposed yet: a new address in either is refused at submit with `400` (see
[Not yet available](#not-yet-available)). The stored effect shows the future public address as
the "after" value. The proposal is stored in the transaction that checks again,
holding the row, that each attached image is still quarantined for the key; one
released meanwhile is refused with `400` and the live route's message, with a
form error naming no field: "An image this key uploaded for approval is no
longer available; upload it again". A released row counts as
gone for the submit check and the approval; toward the key's limits it counts
until its object is deleted and the row removed. An owner session and a
direct-mode key set any address the live validator accepts, exactly as before.

**Owner preview.** `GET /api/change-proposals/:id/assets/:digest`
(`getChangeProposalImage`) serves, to the verified owner in their own session
with `proposal:read`, the quarantined bytes of an image that the pending
proposal `:id` attaches. When the key holds no quarantined copy of it but a
live field of the workspace shows its address (an earlier approval published
it, and approval accepts it once its bytes still hash to the digest), the route serves the published copy
under `image-assets/` with the same checks instead. The server reads the bytes, checks their hash again
and answers them with the image's content type, `x-content-type-options: nosniff` and `cache-control: private,
no-store`. The disposition is `inline` for a raster image and always
`attachment` for SVG. The public asset route only asks the storage for
`attachment` on an SVG through a signed response override, which a provider
that ignores overrides does not apply; for that case every SVG under
`image-assets/` is also stored with `content-disposition: attachment`
([Storage](storage.md#image-prefixes)). A key, an admin, an
unverified or impersonating owner, another workspace, a decided or expired
proposal, an image the proposal does not attach, an image neither quarantined
nor shown by a live field and one whose object the storage reports missing or whose bytes no
longer hash to the digest get `401`, `403` or `404`; a failed storage request
is answered with its storage error. No key can read quarantined bytes.

The [owner panel](#owner-panel) loads a pending proposal's proposed
content-addressed image only from this route: a raster image is shown with a
loading and a failed state, its format, a fingerprint (the first twelve
characters of the digest), the address it will have and a note that only the
owners of the workspace can see it and that it becomes public at this address
when the proposal is approved. The address is shortened in the middle of the
digest (the fingerprint, an ellipsis, the last four characters, then the
extension), with the full address as its title and for assistive technology.
When the preview cannot be loaded, a warning takes the place of the picture:
the image could not be loaded; if it no longer exists, approving changes
nothing and the image has to be uploaded and proposed again; otherwise try
again in a moment. The private note is not shown then. A proposed SVG is never
rendered: the panel shows a labelled download link through the same route, the
same facts and the reason. For a decided proposal the panel keeps the rule for every image
address: it shows an image only for a same-origin public asset path, and it
shortens a content-addressed address the same way.

**CLI.** `shop cover upload <productId> <file>` with a propose-mode key
uploads into the quarantine and proposes the `product.update`;
`shop branding upload <kind> <file>` prints the address and the
`shop settings set` command that proposes it, or proposes it itself with
`--attach`. Both accept `--group <id>` ([CLI](cli.md)).

**Publication on approval.** Approval, single or of a group, publishes only the
images the stored effect sets, the effect the owner reviewed: an image field
left unchanged is not in the effect, so an address the input repeats unchanged
is never read, recorded or written, even when the key holds a quarantined copy
of it. It takes each such image's unreleased row with a share lock inside the approval
transaction, reads its quarantined bytes and checks that they still hash to the
digest in the address. A missing row, an object the storage reports missing or
bytes that no longer match make the proposal (or the whole group) `stale` with
the note "image_unavailable: The proposed image … is no longer available …"
on the `stale` event of the item that attaches it (its group siblings carry the
usual note naming that item), and nothing is
applied; only a failed storage request answers the error and leaves the
proposal `pending`. An address with no row that a live field already shows is
public already: approval reads its public copy inside the transaction and
checks its hash the same way, and a missing copy or bytes that no longer match
make the proposal `stale` with the same note, as the owner preview refuses
it. Every storage request of an approval, of a
publication withdrawal and of the owner's image preview (the read of the
quarantined copy, the check and the write of the public copy, a delete) gives up
after 5 seconds without an answer, the lookup of the storage endpoint included,
the bound a statement of an approval has, and counts as a failed storage request: the approval answers
`503 integration_unavailable` and the proposal stays `pending`, so no storage
request holds the workspace's approval lock longer.

Before the approval transaction opens, the approval reads, for each image the
effect sets, its public object
`image-assets/<workspace>/<kind>/<sha256>.<ext>` and checks its hash. An object
whose bytes hash to the digest is neither written nor recorded, so an approval
never deletes a public object an earlier approval published; a missing object,
or one whose bytes no longer match, is recorded and written again. A storage request that fails here answers its error, and nothing is
recorded or changed. For every other image it commits a publication record of its attempt
in `change_proposal_image_publications` (workspace, attempt, kind, digest,
extension, start time). This single insert runs on its own before the
transaction, so the approval never waits for a second database connection while
it holds one. When every item applied, the approval locks the records of the
images it writes (it answers busy, writing nothing, when one is gone), writes
their bytes after the live change and before the status change and the commit, and
deletes its records in the same transaction, so they disappear exactly when the
approval commits. A quarantined image it did not record must still have its
public object, with bytes that hash to the digest, at that moment, or the
approval answers busy (a failed storage request answers its error); the
workspace's approval lock it holds, and the refusal of every address with an
unresolved delete (below), keep the object there until the commit. Publishing
before the commit, and checking every reused address under that lock, mean
committed live state never points at an object that was missing or did not
match at the commit, also after a crash; only a delete outside the application
or a loss in the storage can remove it later.

When the approval does not end `applied` (it ends `stale`, `failed` or
expired, a write fails, a lock wait runs out, or the status change or the
commit fails), it withdraws its attempt right after the transaction: each
record is removed in a short transaction of its own under the workspace's
approval lock, so no concurrent approval can publish the same address in
between. An object the attempt tried to write is deleted first, except when a
live field shows the address or an applied proposal sets it in one of the five
image fields of its input (an address that appears only in another field, such
as a description, does not count); a record whose object the attempt never tried to write is only dropped. When the
write of an image ended without a definite answer (no answer within its 5
seconds, a connection error, a server error), the storage may still store it
after this delete, so the withdrawal deletes the object but keeps its record,
and the minute sweep deletes the object once more after the record's 10 minutes
and only then removes the record; a write the storage refused (a `4xx` answer)
is withdrawn like any other. The record's 10 minutes then count from the end
of that write, not from the start of the attempt. This rests on the storage
finishing or abandoning a write it accepted within those 10 minutes; the signed
write itself expires 60 seconds after it was signed. An approval starts a write
only within 5 minutes of committing its publication records, or it answers
`503 unavailable` and writes nothing, so a process that dies during a write,
whose record no withdrawal restarts, still leaves the storage at least 5
minutes before the sweep deletes the object. When the delete itself ends without a definite
answer, the storage may still carry it out later, after a new approval has
committed the address, so the withdrawal keeps the record and marks it with the
time of that delete (`delete_unresolved_at`). While such a mark exists, every
approval whose effect sets the address answers `503 unavailable` and changes
nothing; the minute sweep deletes the
object again 10 minutes after the marked delete, under the same assumption, and
only then removes the record, so a retry after that publishes the image
again. Once the withdrawal of an attempt without such a
write succeeds, the attempt has left neither a record nor a public copy behind.
A record it cannot remove (the lock wait runs out, the storage
configuration cannot be read, the delete fails, or the process died first)
stays, and the minute sweep retries it: it removes every record whose start,
or whose last delete without a definite answer, is more than 10 minutes ago,
under the same lock, always deleting its object with the same
exceptions, since it cannot know whether the attempt wrote it, 50 workspaces
and 20 records per workspace per run, and leaves a record it again cannot
remove for the next run, with the time of that attempt, so it moves behind the
other records. A public object written by an approval that did not end
applied is therefore removed once the sweep reaches its record and that
workspace's storage answers, unless a live field shows its address or an
applied proposal sets it in an image field. A record names no bucket: when the
workspace's storage connection changed in between, the delete goes to the
current bucket, the record is removed and the copy in the earlier bucket
stays until someone deletes it there.

**Cleanup.** After a decision commits, the quarantined images of the decided
proposals are released: under the workspace's proposal lock, their rows are
marked released when no pending, unexpired proposal of the same key still
attaches them. Then, for each image, a short transaction under the key's lock
that completion takes deletes the object and then the row, if the row is still
released; a completion that revived it meanwhile keeps both. A failed or busy
object delete leaves the row released and invisible, and the sweep retries it.
A delete that ended without a definite answer also records its time in
`delete_unresolved_at`: for 10 minutes after it the sweep leaves the row alone,
and a completion of the same image by that key answers `503 unavailable` instead
of reviving the row, so a late delete never removes a new quarantined copy;
then the sweep deletes the object again and removes the row, and the image can
be uploaded again.
The workspace's approval lock is never held across these storage requests. This
follows an applied, stale or failed
approval, a reject, a withdrawal, a recorded expiry, the revocation of a key
(every image of that key) and a purge. An image held by an approval in progress
is released only after that approval ends. The sweep
(`sweepQuarantinedImages`) finishes every released image, releases every row
left pending for 10 minutes by a completion that did not finish, and releases every
image older than 7 days that no pending, unexpired proposal of its key
attaches, and every image of a revoked or deleted key, 50 workspaces and 200
images per workspace at a time. Images a pending proposal attaches are left
out in the database query itself, so they never fill a batch and an image
behind them is never starved; the query reads the image fields of each
operation from the stored input exactly as the application does. The same
sweep removes expired upload candidates (see Upload) and unfinished publication
records (see above). Workspaces, images, upload candidates and publication
records are each taken longest waiting first, by the time of their last failed
removal (recorded in `sweep_attempted_at`) or else their creation or start,
so rows whose removal keeps failing move behind the others, inside a workspace
and across workspaces. It runs on the existing minute tick
(the `/api/internal/dispatch-email` cron route, after e-mail and refund
dispatch, and the Node ticker, beside them), at most once every 50 seconds per
server process, independently of the [download file
sweep](storage.md#download-file-prefixes): each has its own failure and its own
budget of 10 seconds, and on the cron route both end at the latest 50 seconds
after the tick started, 10 seconds before the 60-second function limit. Within
its budget the three kinds of work, in this order, quarantined images, upload
candidates and publication records, each get an equal share of what is left
among the kinds that have work at the start of the run, and what one kind
leaves unspent goes to the kinds after it, so deletes that keep hanging in one
workspace's quarantine cannot keep the sweep from the publication records of
another. A step
(a release, an image's removal, a publication record's withdrawal) starts only
when what is left covers a lock wait of at least 250 milliseconds and 1 second
for its storage delete; its lock waits get what is left minus that second, and
its delete, the lookup of the storage endpoint included, gets at most 5 seconds
and what is left, so the sweep's lock waits and storage requests end by its
end, and the 10 seconds before the function limit are for its database
statements and the answer. Every statement that lists work or records an
attempt, the first query for the workspaces included, runs with a statement
timeout and a lock timeout of what is left, but at least 1 second; one that
runs out, for example behind a migration that holds an image table, lists
nothing or records nothing, so that part of the run ends and its rows wait for
the next run. A failing sweep is logged and never stops the tick
or the other sweep. The
storage orphan report counts a quarantined object whose row exists as
`pending` and a published content-addressed image a live field shows as
`referenced`.

**Rolling back.** Migration `0169_change_proposal_images` only adds three
tables and their indexes: `change_proposal_images` (with its release time) and
its index on `created_at`, `change_proposal_image_uploads` and its indexes on
the key and on `created_at`, and `change_proposal_image_publications` and its
index on `started_at`. Each `CREATE INDEX` locks only its new, empty table; the
foreign key of each table to `tenants` takes a `SHARE ROW EXCLUSIVE` lock on
`tenants`, which blocks writes to `tenants` (not reads) until the migration
transaction commits, a moment since nothing is scanned.

Migration `0170_key_download_files` adds a nullable `sweep_attempted_at`
column without a default to each of the three tables (constant time; each
table's `ACCESS EXCLUSIVE` lock is held until the migration commits), and a
nullable `delete_unresolved_at` column with a timestamp format check to
`change_proposal_images` and `change_proposal_image_publications` and a
nullable `pending_since` column with the same check to
`change_proposal_images`, and a nullable `first_deleted_at` column with the
same check to `change_proposal_image_uploads`; each check reads its table once
under that lock, which `0169` created moments before or
which holds only rows of unreleased proposals. A release before it ignores these
columns.

The release on production when proposed images were added, `8141fd15`,
predates `0169`. What it does with what this release stores and answers is
proven by `scripts/change-proposal-image-rollback-8141fd15.test.ts`, which
holds literal copies of its schemas and parsing steps:

- It ignores the three tables, and its shop image routes refuse a propose-mode
  key (`403`). Quarantined and candidate objects stay private under prefixes
  its public route never reads; after rolling forward, the sweep of this
  release removes them.
- A pending `product.update`, `product.create` or `settings.update` that
  attaches a quarantined image is an operation it knows: the row, its
  before/after effect, the key receipt and the owner view parse as before. It
  publishes nothing, so approving such a proposal there sets the field to an
  address that has no public copy on either release, and after rolling
  forward the sweep removes the quarantined bytes; the image then has to be
  uploaded and proposed again. Reject such proposals or leave them pending
  until rolling forward; do not approve them there.
- A `stale` event note `image_unavailable: …` reads like any other note within
  its 500 characters.
- A product cover or a branding field (`logoUrl`, `logoDarkUrl`, `faviconUrl`,
  `ogImageUrl`) that an approval set to a digest address parses, since its
  address schemas accept any root-relative path. Its public asset route
  `/api/public/assets/:kind/:file` accepts only random-id file names
  (`<uuid>.<ext>`) and answers `404` for `<sha256>.<ext>`. Visitors see a
  missing cover or logo where the image is shown, the browser's default
  favicon, a share preview without an image, and e-mails sent meanwhile with a
  logo image that does not load. The public copy stays in storage (that release deletes only avatar
  objects; its storage orphan report lists the copy as unreferenced, as a
  report only), and the address is served again after rolling forward.
- A `change-proposal` notification keeps the key name in `authorDisplay` and
  the group in `contextId` and `snippet`, as that release writes them; it drops
  the typed `changeProposal` field when it parses the row, so the bell names
  the key and the group as before.

A panel tab or a CLI of that release talking to this release's server: the
begin answer of a shop image upload for a propose-mode key carries
`servePath: null`, which its client refuses as not matching the contract (that
release's server refused such a key anyway); a direct-mode key's answers and a
completion answer parse as before, without the `quarantined` flag. Its panel
loads a pending proposal's content-addressed image from the public address,
which has no copy before approval, so it shows the address with its note that
the image is not shown.

Before such a rollback, count the pending proposals that attach a
content-addressed image:

```sql
select count(*) from change_proposals
where status = 'pending' and input::text ~ '/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]';
```

and the products and workspaces whose live image fields show one:

```sql
select
  (select count(*) from products where cover_url ~ '^/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]')
  + (select count(*) from tenants where concat_ws(' ', logo_url, logo_dark_url, favicon_url, og_image_url) ~ '/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]')
  as count;
```

When the first is not `0`, keep those proposals unapproved during the
rollback, as above. When the second is not `0`, those images are missing on
that release until rolling forward; nothing is deleted.

Before rolling back past `8141fd15`, delete the `change-proposal` notifications
first: the step is at the end of [Download files](#download-files).

## Download files

A propose-mode key with `shop:catalog:write` can propose new files, new
versions and removals for the files of a digital-download product. Nothing it
stages reaches a buyer until the owner approves a proposal that attaches it.
The use-cases are in `core/server/usecases/change-proposal-files.ts` and the
operations in the registry (`change-proposal-operations.ts`); the routes are
the [download file routes](shop-management-keys.md#download-files) a
direct-mode key uses.

| Who | Sees |
|---|---|
| The key | its own staged files (name, type, size and, for a copy, its source; the SHA-256 only of a file it uploaded itself) and its receipts; never the bytes, a download link or a fingerprint of a copy |
| The owners | the effect (the product's file list before and after), `proposedFiles` on the owner view, and, while the proposal is pending, a 60-second download link to the staged bytes |
| Buyers | nothing until an approval attaches the file; from then on, the file like any other file of the product |

**Staging.** The key stages a file exactly as a direct-mode key does: the
upload, completion, copy and discard routes are of route class `direct` and
run their handler, which needs `proposal:asset:upload` with
`proposal:submit:catalog` (a propose-mode key with `shop:catalog:write` holds
both; one with only `shop:settings:write` gets `403`), and the copy also
`product:read`. The staged file is private: it lives under
`<workspace>/product-downloads/key-files/<key id>/<file>/`, which no route
serves to a key or a buyer ([Download file prefixes](storage.md#download-file-prefixes)),
and it counts against the key's staging limits
([Download files](shop-management-keys.md#download-files)).

**Proposing.** The three file write routes store a proposal instead of running
their handler, alone or in a [group](#groups):

| Operation | Input | Effect |
|---|---|---|
| `download.add` | `{ productId, stagedFileId, versionNote? }` | the product's file list gains the staged file as a new file |
| `download.replace` | `{ productId, replacesAssetId, stagedFileId, versionNote? }` | the staged file becomes the next version of `replacesAssetId` and supersedes the previous latest version |
| `download.remove` | `{ productId, assetId }` | the file version leaves the list, and the newest remaining ready version of its lineage becomes the latest |

The effect compares the product as `{ exists, type, files }`, where `files`
lists every ready file of the product with its `id`, `lineageId`,
`versionNumber`, `latest`, `fileName`, `contentType`, `sizeBytes`,
`fingerprint` (the file's SHA-256, `null` for a file uploaded in the product
editor) and `versionNote`, sorted by id and without timestamps. The new file's
id is the staged file's id, so the dry run and the approval create the same
file and their effects compare equal. The dry run attaches or removes the file
in its rolled-back transaction and makes no storage request; a removal's
storage delete is dropped with the rollback. A removal may name only a `ready`
file of the product: a file the owner is still uploading in the product editor
(`pending`) is in no snapshot, so its removal would show no effect, and it is
refused at submit, alone or in a group, with `400 validation` "Only a ready file
can be removed by a proposal" (the key's file list already shows that file as
`pending`); an approval's replay refuses it the same way, and the owner's own
delete and a direct-mode key's live removal keep removing any file. A dry run of
one of the three file operations whose effect is empty is refused with
`400 validation` as well, so no file proposal with an empty effect is stored;
so is a `product.set-access` whose list equals the live one
([Product access](#product-access)). The other operations store an empty
effect, and its approval applies the command, which changes nothing. Every stored file proposal therefore compares
the product's ready file list, and a list that changed after the proposal in
any way (another file attached, replaced or removed, or an upload of the
product editor completed, live or by another approval) makes the approval
`stale`.

Before the dry run, the submission checks read-only that the staged file is
one this key staged and that no proposal holds it other than one that ended
`stale` or `failed`: a pending proposal holds it, and so does a rejected,
withdrawn or expired one until the release after that decision (or the minute
sweep) has discarded it, so that release always finds the file; the
transaction that stores the proposal locks the staged row and checks again,
then links the row to the new proposal. A file is therefore held by at most one
pending proposal, and a group cannot attach it twice. A file of another key, a
discarded, unknown or held file, also one an ended proposal has not released
yet, answers `400 validation` with the field error
`stagedFileId: Must be a file this key staged that no other pending proposal
attaches`, and nothing is stored; a file the key discards while its own
submission is running gets the same answer, since a dry run that finds no file
checks the file again. The key may still discard a file a pending
proposal holds; an approval of that proposal then ends `stale` (below).

**Owner link.** `GET /api/change-proposals/:id/files/:fileId`
(`getChangeProposalFileLink`) answers the verified owner in their own session,
with `proposal:read`, a short-lived download of a staged file that the pending,
unexpired proposal `:id` attaches and still holds: it asks the storage whether
the object exists and has the recorded size (5 seconds at most), as the
approval does, and answers
`{ "download": { "url", "expiresAt", "fileName", "sizeBytes" } }` with
`cache-control: private, no-store` and `referrer-policy: no-referrer`. `url` is
a signed `GET` of the staged object, valid for 60 seconds, that asks the
storage for `response-content-disposition: attachment; filename*=UTF-8''<name>`,
`response-content-type: application/octet-stream` and
`response-cache-control: no-store`, so the file is always saved, never shown,
and the bytes never pass through the application. The link is a short-lived
bearer capability: whoever holds the address can fetch the file until it
expires. The server never logs it and its answer is never cached. A key, an
admin, an unverified owner and an owner viewing as a member get `401` or `403`;
another workspace, a decided or expired proposal, a file the proposal does not
attach or no longer holds, and an object the storage reports missing or of
another size than the recorded `sizeBytes` get `404`; a malformed id is `400`; any other storage failure is answered with its
error. With the CLI, `proposals file <id> <file id> --out <path>` streams the
file through this link, never printing the link, into a new temporary file next
to `--out` that only the account running it can read (mode `0600`), writes every byte, and moves it onto `--out` only when the bytes
written are `sizeBytes`, and stops reading without writing the chunk that would
go past `sizeBytes`; it refuses an existing `--out` without `--force`, and a
download that breaks off or has another size removes only the temporary file,
so an existing `--out` is never truncated or removed. `proposals show <id>` and
`proposals group show <id>` list the files a proposal or each item attaches and
the command that downloads each one while it is pending ([CLI](cli.md)).

**Approval.** Before the approval transaction opens, the approval reads each
staged file the proposal (or every item of the group) attaches and, when the
proposal still holds it, asks the storage whether its object exists and has the
recorded size. These file checks run at most 4 at a time
(`CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.concurrency`), each storage request
within 5 seconds (`KEY_DOWNLOAD_STORAGE_DEADLINES.headMs`), and every storage
request starts and ends within one wall-clock budget of 25 seconds; the
database reads of the staged rows and of the storage configuration are not
bounded by that budget, so a slow database can extend the checks beyond it,
and a check whose staged row read ends after the budget ends the checks with
`503 unavailable` as below instead of counting the file as gone. A group holds at most as many file
items as its key may have staged files (20), and 20 checks 4 at a time are 5
rounds of at most 5 seconds. The other 35 seconds of the 60-second server
function (`SERVER_FUNCTION_LIMIT_MS`, the `maxDuration` in `vercel.json`) are
left to the transaction and the answer. None of these file checks runs under
the workspace's approval lock; an image a proposal attaches, alone or in a
mixed group, is still read and written under that lock, each storage request
within its own 5 seconds ([Images](#images)). A row that is gone or no longer
held by the proposal, an object the storage reports missing and a different
size count as gone. A check that cannot start with at least 1 second of the
budget left, a check whose staged row read ends after the budget, or any
storage failure other than a missing object on a request whose 5 seconds the
budget shortened, ends the checks with `503 unavailable` and `Retry-After: 5`;
any other storage failure of a request that had its full 5 seconds, a timeout
included, is answered with its error, the first in the order of the items when
several fail. Either way nothing is decided and the proposal or group stays
`pending`. Inside the transaction, before any target lock, the
approval locks each attached staged row of the proposing key and checks that
it is the file the storage confirmed (id, key, object key, size, SHA-256, held
by this proposal). A file that is gone makes the proposal `stale` with the note
`file_unavailable: The proposed file <staged file id> is no longer available,
so the proposal cannot be applied; nothing was changed` on its `stale` event,
and nothing is applied; in a group every file is checked before any item
applies, and one gone file makes the whole group `stale`, with that note on
the item that attaches it and the usual note on the others (the first such
item in group order). The approval holds each staged row until it commits.
The minute sweep, the key's discard and the release after a decision lock the
staged row, delete it and record an owed deletion of its object in one
transaction, and delete the object after that commit while holding only the
owed-deletion row, so a delete whose answer is lost leaves no staged file to
attach or propose. Every one of these paths must lock the staged row to remove it, so it
waits for an approval that holds the row: after the approval commits the row
is gone (attached) and there is nothing to discard or sweep, and a path that
removed the row first leaves the approval nothing to lock, so it ends `stale`.
No database path can remove the object between the check and the attach; a
storage delete the minute sweep sent earlier and whose answer did not arrive in
time can still land later, because the sweep keeps such a staged row
proposable. The
attach makes no
storage request: the new product file points at the staged object, and the
staged row is deleted in the same transaction. A removal's storage delete runs
after the commit; for an object under `key-files/` its owed deletion stays
recorded until the minute sweep confirms a delete
([Download file prefixes](storage.md#download-file-prefixes)). The `files`
lock takes the product row `FOR NO KEY UPDATE`, then its stock row
`FOR UPDATE`, then the product row `FOR UPDATE`, the order a live file write of
a direct-mode key and a draft deletion take, so an approval and a live file
change wait for each other instead of deadlocking.

**In the owner panel.** A file proposal shows one **Files** row, built from
the effect's two file lists matched by id and from `proposedFiles`. A new file reads "Added: workbook.pdf ·
PDF · 12.4 MB · fingerprint 3f6c9a0e12bd", a new version "New version of
workbook.pdf: version 2 → 3 · PDF · 12.4 MB → 13.1 MB · fingerprint
3f6c9a0e12bd" (with the new name on its own line when the new version is named
differently), and a removal "Removed: workbook.pdf version 2 · PDF · 12.4 MB",
followed by the version that becomes current, the version that stays current
or that no version of the file is left. Only when the file list after the
removal holds no ready file does the row add "This is the product’s only file.
If the product is published when you approve, it stays published with nothing
to download."; a list that changes after the proposal makes the approval
`stale`, so only the product's publication can still differ when it applies.
The type is shown by its label (PDF,
EPUB, ZIP, MP3, M4A, MP4, PNG, JPEG; any other type as its raw value). The
fingerprint shows the first twelve characters of the SHA-256, with the full
value as the element's title and for assistive technology, as for a proposed
image; a file uploaded in the product editor has no fingerprint and shows none.
A version note is shown under the file, and a copy names its source ("Copy of
version 2 of a file from “Creator Workbook (print)”", or "Copy of version 2 of
a file from a product that no longer exists"). File names, version notes and
product titles are text a key or a person wrote, and each sits in its own
`<bdi>` element, inside the row and inside the confirmation. The lines that
show them, in the row, in the confirmation and in a group confirmation, break
anywhere, so a 255-character name with no space wraps at 390 px instead of
running past the edge of the dialog.

While the proposal is pending, the row of a new file or a new version has
**Download file**. It asks the [owner link](#download-files) route, shows
"Preparing the download…" while it waits, and then navigates to the returned
address, which the storage answers as an attachment to save; the page never
shows the address and never previews the file. While it waits the button keeps
keyboard focus and is marked `aria-disabled` and `aria-busy`, so the busy
label is announced, and a second press asks nothing. A `404` replaces the
button with the warning "This file is no longer available; approving changes
nothing.", in the warning style of a proposed image that cannot be loaded, and
moves focus to the warning; any other failure keeps the button and says the
download could not be started. When `proposedFiles` says the proposal no longer holds
the file, the row shows the same warning instead of the button. A decided
proposal shows the row without either.

The confirmation is built from the same data. A new file: "“workbook.pdf” (PDF,
12.4 MB, fingerprint 3f6c9a0e12bd) will be added to “Field Guide (digital)”.
Everyone who has access to this product, current buyers included, can download
it at once." A new version that keeps the name: "A new version of
“workbook.pdf” (PDF, 13.1 MB, fingerprint …) becomes version 3 in “Field Guide
(digital)”; buyers get the new version."; one named differently names both
files: "“workbook-2027.pdf” (PDF, 13.1 MB, fingerprint …) becomes version 3 of
“workbook.pdf” in “Field Guide (digital)”; buyers get the new version." A new
file or a new version that is a copy adds its source, because approving gives
the bytes of the other product's file to everyone with access to this one: "It
is a copy of version 2 of a file from “Creator Workbook (print)”.", or "It is a
copy of version 2 of a file from a product that no longer exists." A removal:
"Buyers of “Field Guide (digital)” will no longer be able to download
“workbook.pdf” version 2." followed by the version that becomes or stays
current, or that no version of the file is left. "Nothing else changes."
follows, as after any sentence that names every changed field; when the file
list changed in any other way than the one proposed change, the confirmation
names the operation and counts the changed fields instead. A removal whose file
list after holds no ready file adds the only-file sentence above, and a
proposal that attaches a file adds "If the proposed file no longer exists,
approving does nothing." A group with a file item is approved like any other group:
its confirmation repeats the sentence of each file item, with the copy source
as above; a file added to a product an earlier item of the group creates reads
"… will be added to “Field Guide (digital)”. Everyone who later gets access to
this product can download the file." instead of naming current buyers. It adds the only-file sentence when an item's removal
leaves its product no ready file and no later item of the group changes that
product's files, and "If the proposed file no longer exists, none of the
changes is applied." when an item attaches one ("If one of the 2 proposed files
no longer exists, none of the changes is applied." for two distinct files).

An approval that ended `stale` because a file was gone, the note code
`file_unavailable` on its `stale` event, is explained in the settled notice and
in its history row as "The proposed file is no longer available, so nothing was
changed. It has to be staged and proposed again."; the row's status reads "Not
applied: file no longer available" and its timeline entry "Not applied: the
proposed file was no longer available", without the note code. The other items
of its group keep the generic label.

**Release on decisions.** After a decision commits, the files of the decided
proposals are released, never failing the decision: a rejection, a
withdrawal (by the key, or by revoking or purging it) and a recorded expiry
discard the staged file (its deletion is owed and its object deleted, the
sweep retrying a delete that fails); a `stale` or `failed` approval only lets
go of the file, which stays staged for the key until it is discarded or its 7
days pass, so the key can propose it again without uploading it again; an
applied attach has made the file a product file. Revoking a propose-mode key
also discards the staged files of that key at once, and a purge discards the
files whose proposal has ended. The minute sweep never removes a staged file a
pending, unexpired proposal holds, even after its 7 days; it also removes a
file still linked to a rejected, withdrawn or expired proposal, in case the
release after that decision did not finish.

**Rolling back.** The release on production when these operations were added,
`8141fd15`, predates migrations `0168` to `0170`, so a rollback to it also
retreats past `0170_key_download_files`; the tables and columns it then
ignores are listed under the [key rollback](shop-management-keys.md#rollback).
What that release does with what this release stores is proven by
`scripts/change-proposal-download-rollback-8141fd15.test.ts`, which holds
literal copies of that release's schemas and parsing steps:

- A `download.add`, `download.replace` or `download.remove` proposal, alone or
  as a group item, passes that release's stored-operation shape check, its
  input is a JSON record and its `files` effect a before/after change, so the
  owner list, show and summary, the key's list, show and withdrawal, a
  rejection and a key revocation read it as before. Its panel shows the
  proposal with the unknown-operation notice and **Approve** disabled, where
  the page of this release shows its file row and approves it (In the owner
  panel, above). Its approval ends
  `stale` with the note `This release does not know the operation
  "download.add", so the proposal cannot be applied; nothing was changed` before
  any target lock, and nothing is applied; in a group that item halts the group
  and nothing of it applies.
- That release has no download file route for a key (`404`); the owner's file
  routes and buyer downloads answer as before. It never releases or sweeps a
  staged file: a rejection or withdrawal there leaves the staged row linked to
  its proposal and the object in place, private; an approval there leaves the
  row linked to a proposal that is now `stale`. After rolling forward, the
  minute sweep of this release removes a file linked to a rejected, withdrawn
  or expired proposal, and any other staged file 7 days after staging or once
  its key is revoked, expired or purged; a file linked to a proposal that ended
  `stale` is free for its key to propose again until then.
- A `stale` event note `file_unavailable: …` reads as any note within its 500
  characters.
- A product file an approval attached is a `ready` file row there, served and
  deleted by its stored object key like any other file; that release neither
  selects nor parses the `sha256` column.
- The storage probe's `signedResponseOverrides` is part of an answer only and
  never stored; that release's diagnostic schema drops it.
- This release adds no notification kind: a file proposal raises the
  `change-proposal` notification that `8141fd15` already knows.

A panel tab or a CLI of that release talking to this release's server meets
the [`proposedFiles`](#owner-view) key and fails to parse the answers that carry
it until it is reloaded or updated; after a rollback the server no longer sends
it. Before the rollback, count the proposals it can no longer apply:

```sql
select count(*) from change_proposals
where status = 'pending' and operation like 'download.%';
```

**Rolling back past `8141fd15`.** The notification kind `change-proposal`
first shipped in `8141fd15`; its parent release `b6a8634a` and every earlier
release have a closed list of notification kinds without it and parse every
notification row they read against that list. Before rolling back to such a
release, delete those rows:

```sql
delete from notifications where kind = 'change-proposal';
```

If this step is skipped, that release throws on such a row: listing the
notifications of an owner whose page holds one, and marking one read, answer
`500` until the rows are deleted or the release rolls forward; its unread
count still counts them. The rows only point the owner to the proposals, which
stay listed under [Change proposals](#owner-panel) after rolling forward.

## Product access

A propose-mode key with `shop:catalog:write` can propose the whole list of what
a product grants: the courses, modules and lessons its access items name. A
purchase does not copy that list. Access is resolved on every request from the
current access items of every product the member holds an active grant for
(`core/server/usecases/entitlements.ts`), so a changed list applies at once to
everyone who already has access to the product, current buyers included: they
get what the new list names and lose the access this product gave them to what
it no longer names, unless another product they hold grants it; a preview
lesson stays open to every signed-in member, and staff keep their access. The
download files of a product and the spaces
that name it are not part of this list.

What an item grants (`core/server/usecases/access.ts`):

| Item | Grants |
|---|---|
| `{ level: "course", courseId }` | every module attached to the course, with every lesson in it, inside that course |
| `{ level: "course", courseId, excludedModuleIds }` | the same without the excluded modules; they stay closed only inside this course |
| `{ level: "modules", courseId, moduleIds }` | each module itself, in every course it is attached to |
| `{ level: "lessons", courseId, lessonIds }` | each lesson itself, in every course that uses it |

The `courseId` of a `modules` or `lessons` item does not limit where its modules
or lessons open; it names the course they were chosen from.

Exclusions apply only inside the course whose item names them
(`buildAccessLookup`). For each course, a module is closed inside that course
when every `course` item for that course among all the member's products
excludes it and no `modules` item of their products names it; a `lessons` item
still opens its lessons. A module attached to two courses and excluded by a
`course` item for one of them stays open inside the other for a member who
gets the other course as a whole, from the same product or from another one.

A lesson sits in every course of every module that holds it; these places are
ordered by module creation time, then by the module's course order
(`lessonLocations`), and the first of them is the lesson's first course. A
lesson opens when the member's items open it in any of these places
(`locateAccessibleLesson`): the lesson player with its media, editions and
attachments, completion, discussions, discussion search and the reach of
lesson-thread notifications check every place. Where a member is sent or
progress is recorded follows a course that opens the lesson for them:

- a lesson-thread notification (the e-mail link and the course of the in-app
  notification) names, for each member, the first place their items open when
  the notification is first stored; staff get the lesson's first course, so
  does a member it opens there. A retried delivery of an already stored
  notification links the e-mail into the first place their items open at the
  retry, while the in-app notification keeps the course stored with it;
- the next lesson (`GET /api/student/lessons/next` and the CLI's
  `student next`) is taken from the first course that opens the lesson for a
  member, or from the lesson's first course when none does; staff walk the
  lesson's first course;
- completion and un-completion take the course the member is viewing as an
  optional `courseId` (the lesson player sends the course it shows) and are
  recorded under it when it opens the lesson for the member (for staff, when
  it holds the lesson), otherwise under the first course that opens it; a
  request without `courseId`, as from the CLI or an older player, is recorded
  under the first course that opens it. Un-completion also removes the lesson
  from the member's own progress of the named course when that course holds
  the lesson but no longer opens it for them, so a completion recorded there
  while it was open does not come back; both rows change in one database
  transaction, so a failed request leaves both as they were and a retry
  finishes the job. A named course that does not hold the
  lesson, or that belongs to another workspace, is never written. Once the
  request settles, the player shows the progress the server holds: the course
  it shows, and the course the request was recorded under when that is
  another one, each read again from the server;
- a lesson hit on the search page links only into a course of the member's
  navigation whose tree opens the lesson. While course trees are still
  loading, a hit that no loaded tree opens is held back; once loading ends, a
  hit that no tree opens, including when the tree of the course that would
  open it failed to load, is listed without a link among the hits whose lesson
  does not resolve. A course's own discussion search covers only the lessons
  that course opens.

Releases before this rule pooled exclusions: a module excluded by a `course`
item for any course stayed closed in every course the member got as a whole,
and a lesson was checked only in its first course, in the first module that
holds it. The change only opens content. A course item's exclusions for one
course are now a subset of what was pooled, and a lesson open in its first
course is still open there, so no member loses a module or a lesson. Members
gain:

- (a) a module attached to two or more courses, excluded by a `course` item for
  one of them, inside another of its courses that a `course` item of theirs
  grants as a whole (without excluding it), from the same product or another
  one;
- (b) a lesson whose first course does not open it for them while another
  course that holds it does, for example a member who gets only the second
  course of a shared module;
- (c) a lesson that also sits in another module, of the same or another
  course, that their items open while the first module holding it is excluded
  for them.

Count the modules and the products of case (a) in a workspace before deploying
(replace `acme` with the workspace id):

```sql
with excluded as (
  select p.id as product_id, item->>'courseId' as course_id, excluded_id
  from products p
  cross join lateral jsonb_array_elements(p.access_items) item
  cross join lateral jsonb_array_elements_text(coalesce(item->'excludedModuleIds', '[]'::jsonb)) excluded_id
  where p.tenant_id = 'acme' and item->>'level' = 'course'
)
select count(distinct e.excluded_id) as modules, count(distinct e.product_id) as products
from excluded e
join course_modules m on m.tenant_id = 'acme' and m.id = e.excluded_id
where exists (select 1 from jsonb_array_elements_text(m.course_ids) other where other <> e.course_id);
```

The query counts distinct excluded modules attached to another course and
distinct products whose `course` items exclude them, not members: a member
gains such a module only while they also hold a `course` item for another of
its courses. It does not count cases (b) and (c).

**One check.** `checkProductAccessItems`
(`core/server/usecases/product-access-items.ts`) is the one check of an access
list. The owner's access editor (`updateProductAccessItems`, also reached by an
admin), product creation (`createProduct`, so a direct-mode key's
`POST /api/m2m/shop/products` and a `product.create` proposal as well) and
`product.set-access` run it:

- every course exists in the workspace and is not archived;
- every module of a `modules` item, and every excluded module of a `course`
  item, exists and is attached to the item's course;
- every lesson of a `lessons` item exists and sits in a chapter of a module
  attached to the item's course.

A course, module or lesson of another workspace is never found. The check
answers `400 validation` with one of the messages "Product access items may
only reference existing, active courses", "… existing modules", "… existing
lessons", "Product access moduleIds must belong to the item courseId",
"Product access excludedModuleIds must belong to the item courseId" or
"Product access lessonIds must belong to the item courseId through its modules
and chapters", for the first item in the order of the list that fails. The
check reads the courses, the modules and the lessons of the whole list in one
query each, and the workspace's modules once when the list has a `lessons`
item, whatever the number of items, so a long list costs the locks it runs
under no more round trips than a short one.

Stored lists are not rewritten. The owner's editor runs the check only when the
list it is sent grants something other than the stored list (items and ids
compared in any order, repeats ignored), so a save that resends the stored list,
as the checkout consent save of the product editor does, succeeds for a product
whose stored list the check would refuse, unless that list names an archived
course, which the write itself refuses. Changing the list is refused until
every item passes. A `product.create` proposal stored before the check existed
is checked at its approval and ends `failed` when its list fails it.

The check is a point-in-time check. It reads the courses, modules and lessons
when the list is written, and the write locks only the courses (`FOR UPDATE`)
until it commits; modules and lessons are not locked, so nothing prevents a
module detach, chapter edit or lesson move during or after the check, and a
list that passed can later name a module or lesson its course no longer
reaches. The access issues report (`GET /api/products/access-issues`)
lists a stored module of a `modules` item or lesson of a `lessons` item that the
item's course does not reach.

Three paths write access items without the check: the content import
(`core/server/usecases/m2m-import.ts`), the legacy importer
(`adapters/db/importer.ts`), and lesson deletion (`deleteLesson`), which removes
the deleted lesson from every `lessons` item. Lesson deletion deletes the lesson
first and then writes each product that names it, up to 3 times when the
product is busy; when a product stays busy it answers `503 unavailable` ("The
lesson was deleted, but a product that granted it was busy and still names it
in its access list"), and that product keeps the id of the deleted lesson,
which grants nothing, until its list is saved again: deleting the lesson again
answers `404`. An import key with
`import:content-write` updates a product it imported only while that product is
unpublished, but an unpublished product can still have members with active
grants from earlier sales or owner grants. A re-import therefore changes what
they open at once, with no proposal or owner approval, and its list can name
modules or lessons outside the item's course.

**Proposing.** `POST /api/m2m/shop/products/access` takes `{ id, accessItems }`
and nothing else: `checkoutConsentDefinitionIds`, which the owner's editor also
sets, is refused with `400`. `id` may be a `$proposal:` reference to the product
an earlier item of the same [group](#groups) creates; the group dry run replays
that item first. A propose-mode key gets `202` with a receipt, which carries the
ids the key sent and nothing about the courses. A direct-mode key reaches the
live handler, `updateProductAccessItems`, which needs `product:access:write`; no
scope grants a key that capability, so it gets `403` and nothing changes. A
physical product cannot grant access items (`400`), as in the editor. The CLI
command is `shop products access <productId>` ([CLI](cli.md)).

The route's input refuses a list that repeats an item (two items that grant the
same, ids in any order) or an item that repeats an id, with `400 validation`;
the owner's editor accepts both. A proposal may exclude any module attached to
the item's course, including one that other courses also use; the exclusion
holds only inside that course.

The effect compares the product as `{ exists, accessItems }`, so it is
`{ "accessItems": { "before": [...], "after": [...] } }`, each list as stored and
as sent. Lists are compared item by item: items in any order, ids within an
item in any order, repeats ignored; two lists that grant the same through
differently shaped items (a module list split into two items, intersecting
exclusions) count as different, which can only make a proposal stale or let a
change of nothing through to the owner, never treat a different grant as the
same. A list equal to the live one in this comparison would change nothing and is refused at submit with `400 validation` ("Invalid product access
payload: it would change nothing the owner can see"); the list is stored and
applied in the order it was sent.
The dry run runs the use-case with the identity of the owner who issued the
key and rolls back; the approval runs it with the session of the approving
owner.

**Locks and outcomes.** The dry run and the approval lock the courses the new
list names first (`FOR UPDATE`, in id order, as the live write of access items
does), then the product row (`FOR NO KEY UPDATE`) and its stock row, as for a
product update; the use-case then writes the list and refuses an archived
course. A `product.create` likewise locks the courses its list grants before it
creates the product. In a [group](#groups), the dry run and the approval
first lock, in one statement and in id order, the courses that the
`product.set-access` items name and the `product.create` items grant, before
any item locks a product row; each of those items requests its courses again
when it runs, which takes nothing new. The owner's editor and the content import also lock the courses
before they write the product. When Postgres aborts the editor's write as a
deadlock victim, or a lock or statement wait runs out, the editor answers
`503 unavailable` ("The product is busy; nothing was changed, retry the
request") and nothing is written. The approval is `stale` when the product's
list no longer equals, in that comparison, the "before" the owner saw, `failed` with the
`validation` error when the list no longer passes the check (a lesson moved out
of its course, a course archived or deleted), and `applied` otherwise, with the
product as `appliedResourceId`.

**Owner view and panel.** The owner view of a `product.set-access` carries
[`accessLabels`](#owner-view), the titles of every course, module and lesson of
both lists and, when one is, `archivedCourses`, the archived courses of either
list, all read at read time for display only. A page reads the titles of
every access proposal on it together, in queries of at most 10,000 ids each
(Postgres binds at most 65,535 parameters in one statement), so a page that
names more ids than that still reads. A replaced list changes what
its holders open only among the courses, modules and lessons that either list
names; another product's items keep granting what they grant.

The panel shows one row, "Included access", with both lists in words: "the
whole course “Intro course”", "the course “Intro course” without its module
“Extras”", "the module “Basics” in every course that uses it (chosen from
“Intro course”)", "the lessons “Welcome”, “Goodbye”, each in every course that
uses it (chosen from “Intro course”)". An id that no longer exists reads
"something that no longer exists" with the id, a course, module or lesson
title that another one of the same kind in either list also bears is followed
by its id ("“Introduction”
(lesson-2)"), so replacing one with another of the same title still reads as a
change, an archived course is followed by "(archived)", and an empty list reads "no course, module or lesson". In Polish the confirmation leads in with "after approval the product
will give access to the following content:", so the phrases that follow are in
the nominative, and an empty list reads "no courses, modules or lessons".
Course, module and lesson titles each sit in their own `<bdi>` element, and the
phrases break anywhere.

While the proposal is pending, the row adds a warning when the list after
approval names an id that no longer exists or an archived course: as the shop
is now, the list does not pass the shop's check and approving would change
nothing unless that changes before the owner approves. A decided proposal shows
the row without the warning.

The confirmation reads "Buyers of “Field guide” will get access to: the whole
course “Intro course”. Everyone who already has access to this product, current
buyers included, gets what this list names at once and loses what it no longer
names, unless another of their products still opens it for them. Nothing else
changes."; for an empty list it says that the product will no longer grant any
course, module or lesson and that everyone who has access loses what it granted
at once, unless another of their products still opens it for them. When the
list does not pass the check as the row's warning describes, the
confirmation leads with "As the shop is now, the new list of what “Field guide”
grants does not pass the shop’s check, so approving would change nothing; if it
passes the check when you approve, it applies as follows." and then gives the
sentence above: the approval checks the list again, so a course restored or a
lesson moved back in the meantime lets it apply. A group
confirmation adds one access sentence per product, for the list that the
product's last access item in the group leaves, since every item applies in one
transaction and no holder ever gets a list an earlier item sets; the cards of
the group still show each item's lists before and after. For a product an
earlier item of the group creates it reads "Everyone who later gets access to
the new product “Starter Pack” will get access to: …" (or "The new product
“Starter Pack” will not grant any course, module or lesson."), and a list that
does not pass the check leads with "… so approving would apply none of the
changes; if it passes the check when you approve, the group applies and the
list as follows.".
`proposals show` and `proposals group show` print the titles under `names:`,
and "no longer exists" for an id that no longer exists; they do not mark an
archived course.

**What the key learns.** No shop route serves a key a course, module or lesson;
the key sees their ids in the access items of the products it lists. A
refusal of the check names no title, but it tells the key whether an id it
sent is an active course of the workspace and whether a module or lesson
belongs to the course it named; a direct-mode key's `product.create` already
told it the first.

**Rolling back.** The release on production when this operation was added,
`8141fd15`, does not know `product.set-access`; what it does with what this
release stores is proven by
`scripts/change-proposal-download-rollback-8141fd15.test.ts`:

- A `product.set-access` proposal, alone or as a group item, passes that
  release's stored-operation shape check, and its `accessItems` effect is a
  before/after change, so the owner and key lists, shows, rejections and
  withdrawals read it as before. Its panel shows the unknown-operation notice
  with **Approve** disabled, and its approval ends `stale` with the note
  `This release does not know the operation "product.set-access", so the
  proposal cannot be applied; nothing was changed` before any target lock;
  in a group that item halts the group and nothing of it applies.
- That release has no `POST /api/m2m/shop/products/access`, and its product
  creation and owner editor do not check where a lesson sits, so after a
  rollback they accept the lists this release refuses.
- A panel tab or a CLI of that release talking to this release's server fails
  to parse an owner view that carries `accessLabels` until it is reloaded or
  updated; after a rollback the server no longer sends it.
- Exclusions per course store nothing new. That release pools exclusions again
  and checks a lesson only in its first course, so the members who gained a
  module or a lesson with this release ([Product access](#product-access))
  lose it again at once. A list with such an exclusion that an approved
  `product.set-access` wrote counts among them. That release also links every
  lesson-thread notification and walks the next lesson in the lesson's first
  course, and drops the `courseId` a lesson player of this release sends with
  a completion, recording it under the lesson's first course. Completions this
  release recorded under another course stay in that course's progress.

Before the rollback, count the proposals it can no longer apply:

```sql
select count(*) from change_proposals
where status = 'pending' and operation = 'product.set-access';
```

and the modules and products whose exclusions close again, with the query in
[Product access](#product-access).

## Not yet available

- **Other file changes.** Renaming and reordering files cannot be proposed.
- **Spaces of a product.** Which spaces a product opens is set on the space
  (`space:write`); no shop management key can change it, directly or as a
  proposal.
- **Course reads.** No shop route serves a key a course, module or lesson; the
  key sees their ids only in the access items of the products it lists.
- **Other images.** Images other than product covers and branding (course
  covers, avatars) cannot be proposed.
- **Checkout appearance images.** A propose-mode key cannot propose a new
  `checkoutAppearance.logoUrl` or `checkoutAppearance.iconUrl`: a
  `settings.update` that sets either to an address other than the live one is
  refused at submit with `400` and a validation message on `checkoutAppearance`
  saying that the image cannot be proposed yet. Clearing them, leaving them
  unchanged and the other appearance fields stay proposable; an owner session
  and a direct-mode key set them as before.
- **Retention.** Terminal proposals and their events are kept; a retention
  purge is a follow-up.

## Residual lost update

Approval locks the target row and compares effects, so it never applies
something different from what the owner saw. A live writer (an owner tab or a
direct-mode key) that read the row before the approval took its lock can still
overwrite the applied change afterwards. That lost update exists today between
any two writers of the same row; closing it needs a revision column and is out
of scope.
