# Staging

Staging is the `staging` branch Vercel Preview deployment backed by an empty
database on a protected Neon branch. It is not a copy of production data.

## Owner Runbook

1. Clear the `STAGING_DATABASE_FINGERPRINT` repository variable so the next
   staging smoke run treats the new fingerprint as unpinned, not mismatched.
2. In Neon, create a branch named `preview/staging` from `main` and keep it
   PROTECTED so the Neon <-> Vercel integration cannot garbage-collect it.
   Deleting this branch takes staging down. On that branch, create an empty
   database through Neon -> branch -> Databases -> New database.
3. In Vercel, scope `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for the staging
   Preview environment to that empty database. Use the pooled URL for
   `DATABASE_URL` and the direct URL for `DATABASE_URL_UNPOOLED`.
4. Redeploy the `staging` branch. Migrations run from `0000` and the deployed
   seed populates the empty database.
5. Verify `https://acme.staging.togethercommunity.app/api/health` reports
   `environment: "staging"`, `production: false`, `database: "up"`, and a
   `databaseFingerprint` different from production.
6. Sign in on the seeded `acme` tenant with
   `kontakt+smoke-creator@togethercommunity.app` and `demo-password-15`, or
   inspect the database for the seeded smoke users.
7. Set or update the `STAGING_DATABASE_FINGERPRINT` repository variable from
   the verified staging health response.
8. Keep `STAGING_SMS_ALERTS` unset unless staging SMS are explicitly rearmed;
   unset or anything but `true` = no SMS from staging; production alerts are
   unaffected.
9. Delete the old data-copied staging branch after the new deployment and smoke
   are green.

## Troubleshooting

If staging build migration fails with `42P07 relation already exists` while
running migration `0000`, the database has tables but no
`drizzle.__drizzle_migrations` rows. That means it was created as a schema-only
copy of `main`, so drizzle-orm's journal-based migrator sees no baseline and
tries to run every migration again. Recreate staging as an empty database on the
protected staging branch.

## Promotion to Production

Production promotions are pull requests from `staging` itself to `main` while
`STAGING_FREEZE=true`. The `promotion-guard` workflow rejects retired
`promote-*` branches, stale staging heads, unfrozen staging, and missing
successful `ci.yml` or `staging-smoke.yml` runs for the exact staging SHA. See
[Promotion](promotion.md) for the owner runbook.

## Deployed Seed Behavior

`app/scripts/vercel-build.ts` always runs migrations before the app build. On
the staging Preview deployment, it then checks for seed markers and runs
`pnpm run db:seed` only when the staging database has none. Production never
runs the deployed seed path.

The manual reset path remains `POST /api/platform/data-reset`, exposed only for
`APP_ENV=staging` and `APP_ENV=preview` and guarded by platform-owner access.
Use it to reset staging data from the deployed seed after staging already
exists; do not use build-time seed as a reset mechanism.

`POST /api/internal/sanitize-staging-secrets` remains available for the
transition from an old copied staging branch. On an empty staging database
populated by the deployed seed, it has nothing to delete.
