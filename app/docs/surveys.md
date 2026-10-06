# Surveys

A survey collects one score and an optional plain-text comment. Workspace owners
and admins manage surveys and view results in Studio under **Marketing → Surveys**. Members and anonymous
visitors can answer an active survey without acquiring a product or joining a
marketing list.

## Public page

The public URL is `/survey/<slug>` on the workspace subdomain or custom domain.
The page uses the workspace branding. Studio provides a copyable public URL;
a stored redirect with a `path` destination can point to this path, including a
short `/link/<key>` URL printed as a QR code. No new edge-forwarded prefix is
required. An unknown or inactive survey displays the workspace not-found notice.

NPS surveys display eleven tiles, from 0 to 10. Star surveys display five stars,
from 1 to 5. A survey has an internal title, public question, workspace-unique
slug, active flag, and an optional comment prompt. Comments are limited to 2,000
characters. After a successful submission the page replaces the form with the
matching ending for the rest of that page view.

Editing the question, scale type, comment toggle or enabled comment prompt
invalidates open forms, which must be reloaded before submitting. Other edits
preserve the form token, including title, activation and ending changes.

## Endings

Each survey defines three contiguous score ranges covering its entire scale.
Defaults are 0–6, 7–8 and 9–10 for NPS, and 1–3, 4 and 5 for stars. Staff can
change the thresholds and author each ending with the same Markdown editor used
for community posts. Public endings use the shared sanitized Markdown renderer.
The editor previews the public form and all three endings.

The workspace owner authors the endings and is responsible for following the
rules of any external review site linked from them. Some review sites forbid
inviting only satisfied customers to leave a review. Score-dependent endings
must not be used to evade those rules.

## Results

Studio shows the current response count, distribution by score, and paginated
responses with score, comment and submission date. Member responses link to the
member record; other responses are labeled Anonymous. CSV export includes the
survey's responses. Its headers (`Member,Score,Comment,Date`) and `Anonymous`
label remain in English regardless of the Studio language, giving imports a
consistent format. Only owners and admins have `survey:read` and `survey:write`.

For NPS, the result is the percentage in the highest configured range minus the
percentage in the lowest configured range; the middle range contributes only
to the denominator. For stars, the result is the arithmetic average. Member
resubmissions replace their previous response and therefore do not increase the
response count. Anonymous submissions remain separate responses. The scale type
can be changed before the first response; afterward, create a separate survey
to use a different scale.

The CLI mirrors survey management through `survey list`, `survey show <id>`,
`survey create --input '<json>'`, and `survey update <id> --input '<json>'`.
Updates include all fields, the survey ID and `expectedRevision` from the latest
read. Use `survey results <id> --page 1 --page-size 25` for paginated results,
`survey export <id>` for CSV in the response envelope, and
`survey delete <id> --confirm` to delete a survey and its responses.

## Privacy and erasure

A signed-in workspace member's response is linked to their member record.
Visitors whose membership is banned or erased submit anonymously.
Anonymous responses contain no stored visitor identifier. Responses do not store
IP addresses or user agents. The public endpoint uses the existing platform
limiter and the public signup form's honeypot and form-token approach. The
existing public-write limits apply to both anonymous and member submissions:
production defaults are 30 writes per IP per minute and 300 per workspace per
minute, configurable through the existing public-rate-limit settings. Limiter
buckets are separate operational data and are never attached to responses.

Member erasure removes member-linked responses in the erasure transaction.
Deleting a survey requires confirmation and deletes its responses. Deleting or
resetting a workspace also removes its surveys and responses. Anonymous responses
cannot be edited later or linked back to a visitor through this feature.

Surveys have one question. Automatic learning prompts, branching, multiple
questions, response notification emails, and per-question styling are outside
this version.
