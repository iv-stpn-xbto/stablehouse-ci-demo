# Changesets

Run `yarn changeset` in a feature branch and commit the generated Markdown file.
Use one app target per file so app release PRs can consume changesets independently.

- Changes under `apps/web/**` target `web`.
- Changes under `apps/backoffice/**` target `backoffice`.
- Changes under `packages/common/**` need no hand-written shared changeset:
  trusted CI creates separate `patch` changesets for `web` and `backoffice`.
- Documentation and CI-only changes need no changeset.

Never target `common`. It stays at the required placeholder version `0.0.0` and
is never released, tagged, or included in a release branch.
