# Course management

Staff with `course:write` can archive and restore courses. Archiving keeps the course and its content; courses are never hard deleted through this workflow. Archiving is refused when any draft or published product in the workspace references the course in its access items. The validation error identifies those products.

The Studio course editor asks for confirmation before archiving. Active courses appear by default; the **Archived** filter shows archived courses and provides **Restore**. Archived courses are excluded from the product access picker, public offer and catalog, member course lists, sitemap, and new import references resolved through `courseKey`. Existing import updates of the archived course itself remain available. Stored redirects to archived or missing courses follow the missing-link behavior: short links under `/link/` return to the workspace home; other paths continue to the normal route fallback. Restoring the course makes its stored redirects work again.

Archiving changes discovery, while grant evaluation and existing members' direct content access retain their existing queries. Restoring a course makes it available to the filtered surfaces again, subject to the same visibility and entitlement rules as before archiving.

Use `course archive <id>` and `course restore <id>` in the CLI. `course list --archived` lists archived courses. Content snapshot restoration uses `course restore-version <versionId>`. The corresponding staff endpoints are `POST /api/courses/archive` and `POST /api/courses/restore`, both accepting `{ "courseId": "..." }`; `GET /api/courses?archived=true` selects archived courses.
