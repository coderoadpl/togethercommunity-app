# Version Surfaces Visual Evidence

Captured for the `feat/version-surfaces` branch after applying harness-wide
`build-stamp` masking.

Commands:

- `pnpm run visual:update`
- SHA-256 manifest of `tasks/visual-goldens/*.png` saved
- `pnpm run visual:update`
- SHA-256 manifest compared against the first run with `diff -u`

Result: the two manifest files were identical.

The PNG files in this directory are pixel diff artifacts generated from the
previous committed baselines and the updated baselines for every changed image.
