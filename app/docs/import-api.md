# Migration import API

The import API moves an existing catalog and audience from another platform into Together. You push courses, modules, lessons, products, members, product grants, and course progress. Products always arrive unpublished and the import sends no e-mail; the import never carries passwords — every imported member is created passwordless and reclaims access via the magic-link or password-reset flow.

Use it when you are switching platforms or restoring a bulk export. Do not use it for day-to-day writes — it creates and updates only records it created, never publishes, and never deletes.

## Import keys

An owner creates import keys in the panel at `/panel/integrations`, under **Integrations → Migration API keys**. The secret is shown once at creation.

| Scope | Grants | Does not grant |
|---|---|---|
| `import:content` | Draft upsert of courses, modules, lessons, and products | Publishing, deleting, editing anything not created by import, any read, any other API |
| `import:users` | Upsert of members (always passwordless), product grants, and course progress | Sending e-mail, the enrollment API, the marketing API, reading member lists, editing members not created by import |

- The two scopes are independent but may be combined on one key. Separate keys reduce the effect of a leaked key and keep their rate-limit counters independent.
- Import scopes cannot be combined with `enrollment`, `marketing`, or `transactional` on the same key. Existing unscoped keys never gain import access.
- **Expiry is mandatory.** The panel defaults to 7 days and caps the lifetime at 30 days. There is no renewal — create a new key.
- An expired key behaves exactly like a revoked one: `401` on every import endpoint. Revocation takes effect immediately.
- Every successful record write, including an `unchanged` result, is recorded in an append-only audit journal per key: kind, `importKey`, resource id, action, payload hash, and timestamp. `GET /api/api-keys/:id/import-audit?cursor=&limit=` (owner session auth, newest first) enumerates the journal so a leaked token can be investigated and cleaned up.

Send the key in `x-api-key`. Resolve the tenant through its normal tenant hostname, or send the tenant slug in `x-tenant` on a shared host — the same as the [transactional e-mail API](transactional-m2m-email.md).

## Endpoints

| Method & path | Scope | Purpose |
|---|---|---|
| `POST /api/m2m/import/validate` | any `import:*` | Dry run: validate records, resolve references, return a plan. Zero writes. |
| `POST /api/m2m/import/courses` | `import:content` | Batch upsert courses |
| `POST /api/m2m/import/modules` | `import:content` | Batch upsert modules and their chapters |
| `POST /api/m2m/import/lessons` | `import:content` | Batch upsert lessons and their content blocks |
| `POST /api/m2m/import/products` | `import:content` | Batch upsert products, always unpublished |
| `POST /api/m2m/import/members` | `import:users` | Batch upsert members |
| `POST /api/m2m/import/grants` | `import:users` | Batch upsert product grants |
| `POST /api/m2m/import/progress` | `import:users` | Batch upsert course progress |

There are no other import-key verbs and no delete endpoint. The owner-authenticated import audit above is the only import listing surface.

## The `together-import/v1` dataset

The HTTP API accepts JSON request envelopes, not a JSONL upload. A JSONL file is a useful local staging format: line 1 can be your own manifest and every following line is one record carrying a `kind` discriminator. Do not send the manifest object to an endpoint. Put the record objects in the `records` array, keep `kind` for `validate`, and remove `kind` when sending records to a kind-specific write endpoint.

```jsonl
{"datasetVersion":"together-import/v1","source":"acme-lms","exportedAt":"2026-08-04T00:00:00Z","counts":{"course":3,"module":46,"lesson":1745,"product":4,"member":377,"grant":774,"progress":377}}
```

`source`, `exportedAt`, and `counts` belong only to this local manifest convention. The server does not accept or enforce them; compare the counts against the validate plan and batch summaries during reconciliation.

### `importKey`

Every record carries an `importKey`: unique within its kind for your tenant, 1–200 characters, matching `^[a-z0-9][a-z0-9._:-]*$`. Derive it deterministically from your source ids so a re-run of your transform produces the same keys:

```text
course-<sourceId>   module-<sourceId>   lesson-<sourceId>
product-<sourceAccessId>   member-<sourceUserId>   grant-<sourceUserId>:<sourceAccessId>
```

Records reference each other by `importKey`, never by Together ids. A reference resolves only to a record created by an import for this tenant, or to an eligible record in the same validation call; native resources are never eligible. Otherwise the referencing record fails with `conflict`. Created resources get `id` equal to their `importKey`, and `legacyId` from the record when you supply it.

`createdAt` is optional for courses, modules, lessons, products, and members and preserves the original creation timestamp. Grant and progress records do not accept it. It is an import-only privilege — the normal APIs never accept it.

### Course

```jsonl
{"kind":"course","importKey":"course-abc123","legacyId":"abc123","name":"Front-end from A to Z","description":"","imageUrl":"https://cdn.example.com/cover.png","moduleOrder":["module-m1","module-m2"],"createdAt":"2020-01-01T00:00:00Z"}
```

`moduleOrder` must contain unique keys. Entries pointing at modules that do not exist yet fail with `conflict`, so submit courses with `moduleOrder: []` first and update them after the modules land.

### Module

```jsonl
{"kind":"module","importKey":"module-m1","legacyId":"m1","courseKeys":["course-abc123"],"title":"Layout","prefix":"01","chapters":[{"id":"chapter-m1-0","name":"Flexbox","contents":[{"id":"content-m1-0-0","name":"Flex container","lessonKey":"lesson-l1"}]}],"createdAt":"2020-02-01T00:00:00Z"}
```

The display name is computed from `prefix` and `title`; it is never accepted as input. `courseKeys` must be unique. Chapter and content `id`s are stored verbatim and must be unique within the module — derive them from your source ids too. Each `lessonKey` must resolve or the record fails with `conflict`.

### Lesson

```jsonl
{"kind":"lesson","importKey":"lesson-l1","legacyId":"l1","name":"Flex container","isPreview":false,"durationMinutes":12,"contents":[{"type":"video","storageKey":"lessons/l1.mp4","streamVideoId":"vid-1","streamCollectionId":"col-1"},{"type":"embed","embedUrl":"https://youtu.be/xxxxxxxxxxx"},{"type":"pdf","pdfUrl":"https://cdn.example.com/l1.pdf","name":"Worksheet"},{"type":"link","url":"https://example.com/docs","description":"Reference"},{"type":"html","html":"<p>Notes.</p>"}],"createdAt":"2020-02-01T00:00:00Z"}
```

Nothing is fetched, copied, or re-hosted. Video blocks require `storageKey` and `streamVideoId`; `streamLibraryId` and `streamCollectionId` are optional. Embed blocks take `embedUrl`, PDF blocks take `pdfUrl` and an optional `name`, link blocks take `url` and an optional `description`, and HTML blocks take non-empty `html`. Existing URLs and stream identifiers must stay usable.

### Product

```jsonl
{"kind":"product","importKey":"product-p1","legacyId":"p1","type":"course","slug":"front-end-full","title":"Front-end full course","description":"","coverUrl":null,"priceCents":0,"currency":"PLN","accessItems":[{"level":"modules","courseKey":"course-abc123","moduleKeys":["module-m1","module-m2"]}],"createdAt":"2020-03-01T00:00:00Z"}
```

`published` is not an accepted field. `type` is `course`, `digital_download`, or `membership`; `priceCents` is a non-negative integer and `currency` is a three-letter uppercase code. `accessItems` use `courseKey` plus `excludedModuleKeys` for `level: "course"`, `moduleKeys` for `level: "modules"`, or `lessonKeys` for `level: "lessons"`. The module and lesson arrays must be non-empty. Unresolved references fail with `conflict`; a slug already used by another product fails with `slug_reserved`.

### Member

```jsonl
{"kind":"member","importKey":"member-u789","legacyId":"u789","email":"user@example.com","displayName":"Jan Kowalski","createdAt":"2021-05-06T00:00:00Z"}
```

`email` is normalized to lowercase and `displayName` is a non-empty string of at most 200 characters. Members are always imported passwordless; no password field is accepted.

### Grant

```jsonl
{"kind":"grant","importKey":"grant-u789:p1","legacyId":"e12,e44","memberKey":"member-u789","productKey":"product-p1","startsAt":"2023-01-01T00:00:00Z","expiresAt":"2026-01-01T00:00:00Z"}
```

One grant per member and product. Collapse renewals and repeated purchases in your transform into a single record using the earliest start and the latest expiry; a second grant for the same member and product under a different `importKey` fails with `conflict`. `startsAt` is required. `expiresAt` may be `null` for lifetime access but cannot be earlier than `startsAt`. Imported grants carry the source `import`.

### Progress

Progress is explicitly enabled in the initial rollout because Together's CodeRoad dogfood migration requires it. There can be only one progress record per imported member and imported course; using another `importKey` for the same pair fails with `conflict`. Access never depends on progress.

```jsonl
{"kind":"progress","importKey":"progress-u789:abc123","memberKey":"member-u789","courseKey":"course-abc123","completedLessonKeys":["lesson-l1"],"lastViewedLessonKey":"lesson-l1","lastViewedModuleKey":"module-m1","lastViewedChapterId":"chapter-m1-0","updatedAt":"2025-11-02T10:00:00Z"}
```

`completedLessonKeys` is required and contains unique keys; it may be empty. `lastViewedLessonKey`, `lastViewedModuleKey`, and `lastViewedChapterId` are optional. Referenced lessons, modules, and chapters must belong to the referenced course. `updatedAt` is required. Progress records do not accept `legacyId` or `createdAt`.

### Order

Submit kinds in dependency order: `course`, `lesson`, `module`, `product`, `member`, `grant`, `progress`. Chunk each kind into batches. Because write endpoints do not resolve forward references, submit a course with `moduleOrder: []` before its modules and then update the course with its final module order. Anything else that still points forward is fixed by re-running the affected kind.

## Validate before you write

```http
POST /api/m2m/import/validate HTTP/1.1
Host: acme.example.com
Content-Type: application/json
x-api-key: <secret shown at creation>

{
  "datasetVersion": "together-import/v1",
  "records": [
    {"kind":"course","importKey":"course-abc123","name":"Front-end from A to Z","description":"","imageUrl":null,"moduleOrder":[]},
    {"kind":"lesson","importKey":"lesson-l1","name":"Flex container","isPreview":false,"durationMinutes":12,"contents":[]}
  ]
}
```

Mixed kinds are allowed when the key holds the scope required by every included kind, and eligible records inside one call may reference each other. A record outside the key's scope receives a per-record `forbidden` error. The call writes nothing.

```json
{
  "ok": true,
  "data": {
    "plan": {
      "create": { "course": 3, "module": 0, "lesson": 1745, "product": 0, "member": 0, "grant": 0, "progress": 0 },
      "update": { "course": 0, "module": 0, "lesson": 0, "product": 1, "member": 0, "grant": 0, "progress": 0 },
      "unchanged": { "course": 0, "module": 46, "lesson": 0, "product": 0, "member": 0, "grant": 0, "progress": 0 }
    },
    "errors": [
      { "index": 12, "kind": "lesson", "importKey": "lesson-l13",
        "error": { "code": "validation", "message": "Invalid import record", "details": { "formErrors": [], "fieldErrors": { "name": ["String must contain at least 1 character(s)"] } } } }
    ],
    "warnings": [
      { "index": 40, "kind": "grant", "importKey": "grant-u1:p1",
        "message": "expiresAt in the past — grant will import as expired" }
    ],
    "valid": false
  }
}
```

Validate checks schemas, per-record scope, duplicate kind-and-`importKey` pairs inside the call, import-lineage reference resolution, duplicate member e-mails, product slug collisions, and whether existing imported records would be updated or left unchanged. A key already used by an imported record is not an error; a key colliding with a native resource is. Validation does not inspect foreign platform identities. The loop is: fix your export, validate, repeat until `valid: true`, then apply.

## Applying a batch

```http
POST /api/m2m/import/courses HTTP/1.1
Host: acme.example.com
Content-Type: application/json
x-api-key: <secret shown at creation>

{
  "datasetVersion": "together-import/v1",
  "records": [
    {"importKey":"course-abc123","legacyId":"abc123","name":"Front-end from A to Z","description":"","imageUrl":null,"moduleOrder":[]}
  ]
}
```

Write endpoint records carry no `kind` field — the endpoint is the kind. The response is `200 OK` even when individual records fail:

```json
{
  "ok": true,
  "data": {
    "results": [
      { "importKey": "course-abc123", "action": "created", "id": "course-abc123" },
      { "importKey": "course-def456", "action": "error",
        "error": { "code": "conflict", "message": "…" } }
    ],
    "summary": { "created": 1, "updated": 0, "unchanged": 0, "failed": 1 }
  }
}
```

Records are processed independently and in order, each in its own transaction. A failing record does not roll back its siblings — re-running is the recovery path.

## Idempotency and safe re-runs

Every write is an upsert keyed by `importKey`, so submitting the same dataset twice is safe and is the recommended way to prove an import is complete.

- First submission → `created`.
- Same payload again → no write, `unchanged`.
- Different payload → `updated`, but only if the target was created by import for this tenant under the same kind and key and remains updatable. Products must still be unpublished; a member's e-mail, a grant's member/product pair, and a progress record's member/course pair cannot change.
- Anything else → `action: "error"` with `error.code: "conflict"` for that record. In particular, two different payloads sharing one `importKey` in a write batch surface as a conflict rather than silently overwriting each other.

The validate plan uses the outcome names `create`, `update`, and `unchanged`. Write results use `created`, `updated`, and `unchanged`; failures use `action: "error"`, with `conflict` appearing as an error code rather than an action.

A full re-run of a finished import returns an all-`unchanged` summary. That is the check to run before you call the migration done.

## Limits

| Limit | Write endpoints | `validate` |
|---|---|---|
| Records per request | 1–200 | 1–5000 |
| Request body | 2 MiB | 10 MiB |
| Requests | 60 per minute per key | 30 per hour per key |

All write endpoints on a key share one daily record counter. Content, grant, and progress requests can claim against a 20,000-record ceiling; member requests can claim only while that same counter remains within 2,000. Use a separate `import:users` key for member batches if you also expect to import more than 2,000 grants or progress records that day. Counters are per key and independent of other tenant keys. Exceeding a limit returns `429` with `error.code: "rate_limited"`; honor the `Retry-After` header.

## Errors

Request-level failures use HTTP status codes:

- `400` with `validation` for a malformed envelope, an unknown `datasetVersion`, too many records, or an oversized body.
- `401` with `unauthorized` for a missing, invalid, expired, or revoked key.
- `403` with `forbidden` when the key lacks the scope the endpoint requires.
- `404` with `tenant_not_found` when the tenant cannot be resolved from the host or `x-tenant`.
- `429` with `rate_limited` when a minute, hourly, or daily limit is exceeded.

Record-level failures appear inside `results[]` (or `errors[]` for validate) and never change the HTTP status:

- `validation` — the record does not match its schema, or a field exceeds its limit.
- `conflict` — a reference lacks import lineage, a divergent payload targets a record that cannot be updated, an e-mail belongs to a pre-existing identity, or a second grant/progress row exists for the same logical pair.
- `slug_reserved` — another product already uses the submitted slug.

## Drafts only

The import surface cannot make anything public:

- Products are always created unpublished; `published` is not an accepted field, and the normal publish blockers still apply, so a product without pricing and delivery cannot be published at all.
- No e-mail of any kind is sent — no invitations, no verification, no welcome messages.
- Nothing is deleted, no tenant settings are touched, no roles or admin rights exist in any payload, and no media is uploaded.
- Records that were not created by import are never modified.

After the data lands: review the drafts in the panel, attach pricing and delivery, publish the products you want live, and tell members to use the magic-link or forgot-password flow. Revoke the import key when you are done — do not wait for it to expire.

## Importing members (passwordless)

Every imported member is created without a password and with an unverified e-mail. The import sends no e-mail. Once e-mail delivery is configured, members reclaim access through a magic link or the forgot-password flow.

- An e-mail already belonging to a pre-existing platform identity cannot be adopted by an import. Deduplicate in your transform and resolve the identity through the normal account flow.

Imported members carry no consent evidence. You are the data controller: import only members you have a legal basis to hold, and notify them on your own terms — the import will not do it for you.

## Build your migration with AI

You do not need a Together-specific integration. Export whatever your platform gives you — a database dump, CSV files, an API export — and have an assistant write the transform from your export's shape to this dataset format.

Give the assistant two things: the record schemas from this document, and a small, secret-free sample of your own export.

> **Prompt template**
>
> I am migrating my course platform to Together. Below are (1) the Together import dataset specification `together-import/v1` — a JSONL format with these record schemas: [paste the record sections of this document]; and (2) a representative sample of my platform's export: [paste two or three records of each entity type, with secrets and personal data removed].
>
> Write a standalone TypeScript script (run with `npx tsx`) that reads my full export from `./export/`, transforms it into a valid `together-import/v1` JSONL file, and follows these rules:
>
> - derive every `importKey` deterministically from my source ids using the documented convention, so re-running the script produces identical keys;
> - preserve original creation timestamps in `createdAt` only for courses, modules, lessons, products, and members;
> - merge repeated enrollments for the same user and product into one grant using the earliest start and the latest expiry;
> - reference other records only by `importKey`, never by generated ids, and emit records in dependency order;
> - write every source field that has no Together equivalent into a separate `unmapped-report.json` instead of dropping it silently;
> - never invent data — if a required Together field has no source value, list the record in `problems.json` instead of guessing;
> - write a manifest line with the real per-kind counts;
> - never put a password or password hash in the output.
>
> Then tell me which of my source fields you could not map and what decisions I need to make.

Review what comes back before you run it. Assistants are good at the mechanical reshaping and bad at silently guessing missing values — `problems.json` and `unmapped-report.json` exist to make those guesses visible.

### Verification checklist

Run through this before you call the migration done.

1. **Counts reconcile.** The manifest counts match your source query totals, and the sum of the batch summaries matches the manifest for every kind.
2. **Validate is clean.** `validate` returns `valid: true` with an empty `errors` array, and every warning has been read and accepted.
3. **The plan matches your expectation.** A first import should be almost entirely `create`; unexpected `update` or `unchanged` entries mean your keys collide with something already in the tenant.
4. **Nothing silently vanished.** `problems.json` is empty or every entry has a decision, and `unmapped-report.json` has been reviewed — keep both files.
5. **Re-run is clean.** Submitting the same dataset again returns an all-`unchanged` summary with zero failures.
6. **Spot-check the drafts.** Open a course in the panel and confirm module order, chapter structure, and lesson blocks of every type you use render correctly; check one product's access items against your source access rules.
7. **Spot-check the people.** Verify one member per access tier has the grant they should have, and request one magic link or password reset for an imported member.
8. **Close the door.** Revoke the import keys, and use the key's import audit to confirm the journal contains exactly what you expected.
