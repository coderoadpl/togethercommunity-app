# Change proposals

A change proposal is a write that a machine asked for and the workspace owner
has not yet decided on. It comes from a [shop management key](shop-management-keys.md)
created in **propose mode**: such a key reads what its read scopes allow, and
every catalogue, sales-link and settings write it sends is stored as a
proposal instead of changing the live shop (download files aside: it cannot
write those yet). The owner reads each proposal with
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
| Owner view with live labels and issuer state, pending summary, owner notification ([Owner view](#owner-view)) | Available |
| Owner panel page `/panel/proposals` ([Owner panel](#owner-panel)) | Available |
| Images (product covers, branding): private upload, address checks, owner preview, publication on approval and cleanup ([Images](#images)) | Available |

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
bounded by the operations registry (the fourteen operations below) and the
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
| `proposal` | the fourteen write routes above | `202` with a receipt; the live handler never runs |
| `direct` | branding and product cover image upload and completion | the handler runs and keeps the image private until approval ([Images](#images)) |
| `refuse`, reason `secret` | integration routes | `403 forbidden` |
| `refuse`, reason `side-effect` | order fulfilment and carrier shipment routes | `403 forbidden` |
| `refuse`, reason `not-in-release` | the [download file](shop-management-keys.md#download-files) routes: upload, completion, copy, the staged file list and discard (`/api/m2m/shop/downloads/*`), and the attach, replace and remove routes (`POST /api/m2m/shop/products/downloads`, `…/replace`, `…/remove`) | `403 forbidden`, with the message that product download files are not available to a propose-mode key yet |
| `proposal-management` | `/api/m2m/shop/proposals` routes | the key's own proposals; a direct-mode key gets `403` |

Reads (`GET`) behave as before for both modes, except the staged download file
list (`GET /api/m2m/shop/downloads/staged`, class `refuse`); a product's file
list (`GET /api/m2m/shop/products/:productId/downloads`) is an ordinary read.
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
`expired`, `revoked`, `purged`), the issuer's state, a live label of the
target, the decision with the deciding account and the event history (see
[Owner view](#owner-view)).

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
| `GET /api/change-proposals?status=&groupId=&cursor=&limit=` | `{ proposals: ownerView[], nextCursor, hasMore }`, newest first |
| `GET /api/change-proposals/summary` | `{ pending, pendingGroups, hasProposals }`: the pending, unexpired proposals of the workspace (grouped items included), the groups they belong to, and whether the workspace holds any proposal at all, whatever its status |
| `GET /api/change-proposals/:id` | `{ proposal: ownerView + events }` |
| `POST /api/change-proposals/:id/approve` with `{}` | `{ proposal: ownerView }` with status `applied`, `stale` or `failed`; a settled or expired proposal is `409` |
| `POST /api/change-proposals/:id/reject` with `{ "note"?: string }` | `{ proposal: ownerView }` with status `rejected`; a settled proposal is `409` |

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
`proposals reject <id> [--note <text>]` and
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
groupTitle }`, with the key name and, for a group, the group id and title; the
community fields `authorDisplay`, `contextId` and `snippet` stay empty. A
notification stored before this field existed held the key name in
`authorDisplay` and the group in `contextId` and `snippet`;
`changeProposalNotificationFacts` in `core/domain` reads both forms, so such a
notification stays readable. There is at most one unread notification per
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

The workspace owner reviews and decides every proposal on one page,
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
does not know is shown but cannot be approved from the page.

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
a group: none of the changes is applied). Reject opens a
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
nothing was changed, and it has to be uploaded and proposed again. "Show more proposals" appends the next page
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
items of its group keep the generic label; an empty
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
loaded story and an unreadable one for the failed story. These stories have no
committed golden.

## Approval

The owner approves one proposal at a time. The approval runs in one database
transaction:

1. lock the proposal row while it is `pending` and unexpired, then read the
   clock again: a proposal that expired while the approval waited for the lock
   is not applied; its expiry is recorded and the answer is `409` with status
   `expired`. Each image the proposal attaches is then taken and verified (see
   [Images](#images)): one that is no longer available makes the proposal
   `stale` without running anything;
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
`stale` because an attached image is no longer available is decided before any
target lock: its decision time is the time read when that was found.

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
| `stale` | unchanged | read the current state and propose the change again, uploading again an attached image that is no longer available; the old proposal stays settled |
| `failed` | unchanged | read `failureCode` on the receipt, fix the cause (for example a stock level that would go below zero), then propose again |

**Stale** means the live state moved after the proposal was made: another
writer (the owner in the panel, a direct-mode key, a checkout) changed a field
the proposal changes, or running the command now would give a different
effect than the one the owner approved. It also means an image the proposal
attaches is no longer available (see [Images](#images)), even when the live
state is unchanged; the key then has to upload the image again before it
proposes again. Approval never applies a change the
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
| `stale` | the owner approved it, the live state had changed or an attached image was no longer available, nothing was applied |
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
starts a third, checked when an upload is started (see [Images](#images)):

| Limit | Value | `changeProposalCap` |
|---|---|---|
| Images awaiting approval per key | 100 | `key_quarantined_images` |
| Bytes of images awaiting approval per key | 50 MiB | `key_quarantined_bytes` |
| Image uploads started per key in 15 minutes, completed or not | 60 | `key_image_uploads` |

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
record older than 20 minutes (the lifetime and a 5-minute margin) and then the
record, whether the upload was completed or not, so neither an upload that is
never completed nor a second `PUT` through a still valid URL stays in the
bucket. Completing it (the matching `.../complete`
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
completion counts the key's limits (above) over its unreleased rows, inserts
the row (or revives a released row of the same image) and writes the
quarantined object before the lock is released; when the write fails, the row
is rolled back, the candidate is deleted and the storage error is answered. Two
concurrent completions therefore cannot both take the last slot, and a
quarantined object never exists without its counted row except while a
completion or a release of it is in progress or recorded for the sweep.

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
gone everywhere: for the submit check, the approval and the limits. An owner session and a
direct-mode key set any address the live validator accepts, exactly as before.

**Owner preview.** `GET /api/change-proposals/:id/assets/:digest`
(`getChangeProposalImage`) serves, to the verified owner in their own session
with `proposal:read`, the quarantined bytes of an image that the pending
proposal `:id` attaches. When the key holds no quarantined copy of it but a
live field of the workspace shows its address (an earlier approval published
it, and approval accepts it as it is), the route serves the published copy
under `image-assets/` with the same checks instead. The server reads the bytes, checks their hash again
and answers them with the image's content type, `x-content-type-options: nosniff` and `cache-control: private,
no-store`; the disposition is `inline` for a raster image and always
`attachment` for SVG, as the public asset route does. A key, an admin, an
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

**Publication on approval.** Approval, single or of a group, takes each
attached image's unreleased row with a share lock inside the approval
transaction, reads its quarantined bytes and checks that they still hash to the
digest in the address. A missing row, an object the storage reports missing or
bytes that no longer match make the proposal (or the whole group) `stale` with
the note "image_unavailable: The proposed image … is no longer available …"
on the `stale` event of the item that attaches it (its group siblings carry the
usual note naming that item), and nothing is
applied; only a failed storage request answers the error and leaves the
proposal `pending`. An address with no row that a live field already shows is
public already and needs nothing. Every storage request of an approval, of a
publication withdrawal and of the owner's image preview (the read of the
quarantined copy, the check and the write of the public copy, a delete) gives up
after 5 seconds without an answer, the bound a statement of an approval has, and
counts as a failed storage request: the approval answers
`503 integration_unavailable` and the proposal stays `pending`, so no storage
request holds the workspace's approval lock longer.

Before the approval transaction opens, the approval asks the storage, for each
attached image, whether its public object
`image-assets/<workspace>/<kind>/<sha256>.<ext>` exists. An existing object
has the same bytes, because its name is their digest: it is neither written
nor recorded, so an approval never deletes a public object an earlier approval
published. A storage request that fails here answers its error, and nothing is
recorded or changed. For every other image it commits a publication record of its attempt
in `change_proposal_image_publications` (workspace, attempt, kind, digest,
extension, start time). This single insert runs on its own before the
transaction, so the approval never waits for a second database connection while
it holds one. When every item applied, the approval locks the records of the
images it writes (it answers busy, writing nothing, when one is gone), writes
their bytes after the live change and before the status change and the commit, and
deletes its records in the same transaction, so they disappear exactly when the
approval commits. A quarantined image it did not record must still have its
public object at that moment, or the approval answers busy (a failed storage
request answers its error); the workspace's approval lock it holds keeps the
object there until the commit. Publishing before the commit means committed
live state never points at an object that does not exist, also after a crash.

When the approval does not end `applied` (it ends `stale`, `failed` or
expired, a write fails, a lock wait runs out, or the status change or the
commit fails), it withdraws its attempt right after the transaction: each
record is removed in a short transaction of its own under the workspace's
approval lock, so no concurrent approval can publish the same address in
between. An object the attempt tried to write is deleted first, except when a
live field shows the address or an applied proposal carries it in its input; a
record whose object the attempt never tried to write is only dropped. Once the
withdrawal succeeds, the attempt has left neither a record nor a public copy
behind. A record it cannot remove (the lock wait runs out, the storage
configuration cannot be read, the delete fails, or the process died first)
stays, and the minute sweep retries it: it removes every record older than 10
minutes under the same lock, always deleting its object with the same
exceptions, since it cannot know whether the attempt wrote it, 50 workspaces
and 20 records per workspace per run, and leaves a record it again cannot
remove for the next run, with the time of that attempt, so it moves behind the
other records. Every public object written by an approval that did
not end applied is therefore removed without anyone's help once the storage
answers, unless a live field shows its address or an applied proposal carries
it.

**Cleanup.** After a decision commits, the quarantined images of the decided
proposals are released: under the workspace's proposal lock, their rows are
marked released when no pending, unexpired proposal of the same key still
attaches them. Then, for each image, a short transaction under the key's lock
that completion takes deletes the object and then the row, if the row is still
released; a completion that revived it meanwhile keeps both. A failed or busy
object delete leaves the row released and invisible, and the sweep retries it.
The workspace's approval lock is never held across these storage requests. This
follows an applied, stale or failed
approval, a reject, a withdrawal, a recorded expiry, the revocation of a key
(every image of that key) and a purge. An image held by an approval in progress
is released only after that approval ends. The sweep
(`sweepQuarantinedImages`) finishes every released image and releases every
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
budget of 10 seconds, every storage delete gets at most what is left of it, and
on the cron route both stop at the latest 55 seconds after the tick started. A
failing sweep is logged and never stops the tick or the other sweep. The
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
table's `ACCESS EXCLUSIVE` lock is held until the migration commits); a release
before it ignores that column. A release before 0169 ignores the three tables,
and its image routes refuse a propose-mode key. Such a release serves only random-id file names from
`/api/public/assets`, so an image published under its digest, and any copy a
publication record still points at, is not served there until rolling forward
again; quarantined and candidate objects stay private, and the sweep removes
them after rolling forward. Approving there a pending proposal that
attaches a quarantined image would set the address without publishing it.
Before such a rollback, count these proposals:

```sql
select count(*) from change_proposals
where status = 'pending' and input::text ~ '/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]';
```

## Not yet available

- **Download files.** Download files of digital products cannot be proposed:
  every [download file route](shop-management-keys.md#download-files) except
  the product file list refuses a propose-mode key with `403` (class `refuse`,
  reason `not-in-release`), and only a direct-mode key stages and attaches
  files, live.
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
