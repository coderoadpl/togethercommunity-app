# Migration import API

The import API moves an existing catalog and audience from another platform into Together. You push courses, modules, lessons, products, members, product grants, and course progress as **drafts**: content arrives unpublished, members arrive able to log in, and nothing goes live and no e-mail is sent until you act in the panel.

Use it when you are switching platforms or restoring a bulk export. Do not use it for day-to-day writes — it creates and updates only records it created, never publishes, and never deletes.

## Import keys

Import keys are created in the panel under **Integrations → Migration API keys**. The secret is shown once at creation.

| Scope | Grants | Does not grant |
|---|---|---|
| `import:content` | Draft upsert of courses, modules, lessons, and products | Publishing, deleting, editing anything not created by import, any read, any other API |
| `import:users` | Upsert of members (with an optional legacy credential), product grants, and course progress | Sending e-mail, the enrollment API, the marketing API, reading member lists, editing members not created by import |

- The two scopes are independent. Create one key per scope — a leaked content key then cannot touch members, and a leaked users key cannot touch content.
- Import scopes cannot be combined with `enrollment`, `marketing`, or `transactional` on the same key. Existing unscoped keys never gain import access.
- **Expiry is mandatory.** The panel defaults to 7 days and caps the lifetime at 30 days. There is no renewal — create a new key.
- An expired key behaves exactly like a revoked one: `401` on every import endpoint. Revocation takes effect immediately.
- Every write is recorded in an append-only audit journal per key: kind, `importKey`, resource id, action, payload hash, timestamp. `GET /api/api-keys/:id/import-audit?cursor=&limit=` (owner session auth, newest first) enumerates everything a key created, so a leaked token can be cleaned up exactly.

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

There are no other verbs. There is no listing endpoint and no delete endpoint; review imported records in the panel.

## The `together-import/v1` dataset

Your transform produces one JSONL file. Line 1 is the manifest; every following line is one record carrying a `kind` discriminator. The record schemas below are exactly the record schemas the endpoints accept.

```jsonl
{"datasetVersion":"together-import/v1","source":"acme-lms","exportedAt":"2026-08-04T00:00:00Z","counts":{"course":3,"module":46,"lesson":1745,"product":4,"member":377,"grant":774}}
```

`counts` are your own totals. Nothing on the server enforces them; you compare them against the validate plan and the batch summaries during reconciliation.

### `importKey`

Every record carries an `importKey`: unique within its kind for your tenant, 1–200 characters, matching `^[a-z0-9][a-z0-9._:-]*$`. Derive it deterministically from your source ids so a re-run of your transform produces the same keys:

```text
course-<sourceId>   module-<sourceId>   lesson-<sourceId>
product-<sourceAccessId>   member-<sourceUserId>   grant-<sourceUserId>:<sourceAccessId>
```

Records reference each other by `importKey`, never by Together ids. A reference resolves only to a record created by an import for this tenant, or to an eligible record in the same validation call; native resources are never eligible. Otherwise the referencing record fails with `conflict`. Created resources get `id` equal to their `importKey`, and `legacyId` from the record when you supply it.

`createdAt` is optional and preserves the original creation timestamp. It is an import-only privilege — the normal APIs never accept it.

### Course

```jsonl
{"kind":"course","importKey":"course-abc123","legacyId":"abc123","name":"Front-end from A to Z","description":"","imageUrl":"https://cdn.example.com/cover.png","moduleOrder":["module-m1","module-m2"],"createdAt":"2020-01-01T00:00:00Z"}
```

`moduleOrder` must contain unique keys. Entries pointing at modules that do not exist yet fail the record, so either submit courses with `moduleOrder: []` first and re-run them after the modules land, or submit in dependency order.

### Module

```jsonl
{"kind":"module","importKey":"module-m1","legacyId":"m1","courseKeys":["course-abc123"],"title":"Layout","prefix":"01","chapters":[{"id":"chapter-m1-0","name":"Flexbox","contents":[{"id":"content-m1-0-0","name":"Flex container","lessonKey":"lesson-l1"}]}],"createdAt":"2020-02-01T00:00:00Z"}
```

The display name is computed from `prefix` and `title`; it is never accepted as input. Chapter and content `id`s are stored verbatim and must be unique within the module — derive them from your source ids too. Each `lessonKey` must resolve or the record fails.

### Lesson

```jsonl
{"kind":"lesson","importKey":"lesson-l1","legacyId":"l1","name":"Flex container","isPreview":false,"durationMinutes":12,"contents":[{"type":"video","storageKey":"lessons/l1.mp4","streamVideoId":"vid-1","streamCollectionId":"col-1"},{"type":"embed","embedUrl":"https://youtu.be/xxxxxxxxxxx"},{"type":"pdf","pdfUrl":"https://cdn.example.com/l1.pdf","name":"Worksheet"},{"type":"link","url":"https://example.com/docs","description":"Reference"},{"type":"html","html":"<p>Notes.</p>"}],"createdAt":"2020-02-01T00:00:00Z"}
```

Media is bring-your-own-storage by URL. Nothing is fetched, copied, or re-hosted, so your existing URLs must stay reachable. HTML blocks are stored byte-for-byte under the same trust model as the lesson editor.

### Product

```jsonl
{"kind":"product","importKey":"product-p1","legacyId":"p1","type":"course","slug":"front-end-full","title":"Front-end full course","description":"","coverUrl":null,"priceCents":0,"currency":"PLN","accessItems":[{"level":"modules","courseKey":"course-abc123","moduleKeys":["module-m1","module-m2"]}],"createdAt":"2020-03-01T00:00:00Z"}
```

`published` is not an accepted field. `accessItems` use `courseKey`, `moduleKeys`, and `lessonKeys` instead of ids; unresolved references fail the record. A slug that is reserved or already taken fails with `slug_reserved`.

### Member

```jsonl
{"kind":"member","importKey":"member-u789","legacyId":"u789","email":"user@example.com","displayName":"Jan Kowalski","legacyPasswordHash":"pbkdf2$25000$<64 hex chars>$<1024 hex chars>","createdAt":"2021-05-06T00:00:00Z"}
```

### Grant

```jsonl
{"kind":"grant","importKey":"grant-u789:p1","legacyId":"e12,e44","memberKey":"member-u789","productKey":"product-p1","startsAt":"2023-01-01T00:00:00Z","expiresAt":"2026-01-01T00:00:00Z"}
```

One grant per member and product. Collapse renewals and repeated purchases in your transform into a single record using the earliest start and the latest expiry; a second grant for the same member and product under a different `importKey` fails with `conflict`. `expiresAt` may be `null` for lifetime access. Imported grants carry the source `import`.

### Progress

Progress is explicitly enabled in the initial rollout because Together's CodeRoad dogfood migration requires it. Like grants, progress may reference only import-created members and content; access never depends on progress.

```jsonl
{"kind":"progress","importKey":"progress-u789:abc123","memberKey":"member-u789","courseKey":"course-abc123","completedLessonKeys":["lesson-l1"],"lastViewedLessonKey":"lesson-l1","lastViewedModuleKey":"module-m1","lastViewedChapterId":"chapter-m1-0","updatedAt":"2025-11-02T10:00:00Z"}
```

### Order

Submit kinds in dependency order: `course`, `lesson`, `module`, `product`, `member`, `grant`, `progress`. Chunk each kind into batches. Anything that still points forward is fixed by re-running the affected kind.

## Validate before you write

```http
POST /api/m2m/import/validate HTTP/1.1
Host: acme.example.com
Content-Type: application/json
x-api-key: together_api_key

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
      "create": { "course": 3, "lesson": 1745 },
      "update": { "product": 1 },
      "unchanged": { "module": 46 }
    },
    "errors": [
      { "index": 12, "kind": "lesson", "importKey": "lesson-l13",
        "error": { "code": "validation", "message": "…", "details": { "path": ["name"] } } }
    ],
    "warnings": [
      { "index": 40, "kind": "grant", "importKey": "grant-u1:p1",
        "message": "expiresAt in the past — grant will import as expired" }
    ],
    "valid": false
  }
}
```

Validate checks schemas, `importKey` uniqueness inside the call and against what you already imported, reference resolution, duplicate e-mails, slug reservations, credential-hash format, and predicts the action for every record. The loop is: fix your export, validate, repeat until `valid: true`, then apply.

## Applying a batch

```http
POST /api/m2m/import/courses HTTP/1.1
Host: acme.example.com
Content-Type: application/json
x-api-key: together_api_key

{
  "datasetVersion": "together-import/v1",
  "records": [
    {"importKey":"course-abc123","legacyId":"abc123","name":"Front-end from A to Z","description":"","imageUrl":null,"moduleOrder":[]}
  ]
}
```

Endpoint bodies carry no `kind` field — the endpoint is the kind. The response is `200 OK` even when individual records fail:

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
- Different payload → `updated`, but only if the target was created by import for this tenant under the same kind and key, and is still updatable. Products must still be unpublished. Credentials are immutable after member creation.
- Anything else → `conflict` for that record. In particular, two different source records sharing one `importKey` surface as a conflict rather than silently overwriting each other.

A full re-run of a finished import returns an all-`unchanged` summary. That is the check to run before you call the migration done.

## Limits

| Limit | Write endpoints | `validate` |
|---|---|---|
| Records per request | 1–200 | 1–5000 |
| Request body | 2 MiB | 10 MiB |
| Requests | 60 per minute per key | 30 per hour per key |

Daily record budgets per key: 20 000 content records (courses, modules, lessons, products), 2000 members, 20 000 grants, 20 000 progress records. Limits are per key and independent of your other tenant keys. Exceeding any of them returns `429`; honor the `Retry-After` header.

## Errors

Request-level failures use HTTP status codes:

- `400` for a malformed envelope, an unknown `datasetVersion`, too many records, or an oversized body.
- `401` for a missing, invalid, expired, or revoked key.
- `403` when the key lacks the scope the endpoint requires.
- `404` when the tenant cannot be resolved from the host or `x-tenant`.
- `429` when a minute, hourly, or daily limit is exceeded.

Record-level failures appear inside `results[]` (or `errors[]` for validate) and never change the HTTP status:

- `validation` — the record does not match its schema, or a field exceeds its limit.
- `not_found` — a referenced `importKey` resolves to nothing in your tenant.
- `conflict` — a divergent payload on a record that cannot be updated, an e-mail already belonging to another member, or a second grant for the same member and product.
- `slug_reserved` — the product slug is reserved or already used.

## Drafts only

The import surface cannot make anything public:

- Products are always created unpublished; `published` is not an accepted field, and the normal publish blockers still apply, so a product without pricing and delivery cannot be published at all.
- No e-mail of any kind is sent — no invitations, no verification, no welcome messages.
- Nothing is deleted, no tenant settings are touched, no roles or admin rights exist in any payload, and no media is uploaded.
- Records that were not created by import are never modified.

After the data lands: review the drafts in the panel, attach pricing and delivery, publish the products you want live, then run the set-password or invite flow for your members. Revoke the import key when you are done — do not wait for it to expire.

## Importing members and their passwords

Members can be imported in two ways.

**Passwordless.** Omit `legacyPasswordHash`. The member exists and appears in your member list but has no password; they gain access through the invite or set-password flow you start from the panel, whenever you choose.

**With the legacy credential.** Supply `legacyPasswordHash` in the exact supported format and the member keeps their existing password:

```text
pbkdf2$25000$<hex salt, 64 characters>$<hex derived key, 1024 characters>
```

That is PBKDF2-HMAC-SHA-256, 25 000 iterations, a 512-byte derived key, salt and key hex-encoded. If your platform stores passwords this way (a hex salt plus a hex PBKDF2-SHA-256 hash), your transform reformats the two columns into this string — no derivation, no password knowledge, no user interaction. The first successful login transparently upgrades the stored credential.

- **Plaintext passwords are never accepted.** There is no `password` field, and nothing else derives a hash for you.
- The value is validated for format only. It is never verified, logged, echoed back, or included in an audit payload hash. The audit records only that a credential was created.
- A credential can be inserted only in the same transaction that creates a brand-new auth user. It can never be added later or written onto a pre-existing platform identity, and it can never be replaced.
- An imported auth identity starts with an unverified e-mail. The imported credential enables migration login but does not satisfy platform-wide verified-email capabilities.
- An e-mail already belonging to a pre-existing platform identity cannot be adopted by an import. Deduplicate in your transform and resolve the identity through the normal account flow.
- If your hashes use bcrypt, argon2, or any other scheme, import those members passwordless and send them a set-password link.

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
> - preserve original creation timestamps in `createdAt`;
> - merge repeated enrollments for the same user and product into one grant using the earliest start and the latest expiry;
> - reference other records only by `importKey`, never by generated ids, and emit records in dependency order;
> - write every source field that has no Together equivalent into a separate `unmapped-report.json` instead of dropping it silently;
> - never invent data — if a required Together field has no source value, list the record in `problems.json` instead of guessing;
> - write a manifest line with the real per-kind counts;
> - never put a plaintext password in the output; only reformat an existing hex salt and hex PBKDF2-SHA-256 hash into the documented credential string, and if my hashes use any other scheme, omit the field.
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
7. **Spot-check the people.** Verify one member per access tier has the grant they should have, log in once with a migrated legacy password, and run one invite through the set-password flow.
8. **Close the door.** Revoke the import keys, and use the key's import audit to confirm the journal contains exactly what you expected.
