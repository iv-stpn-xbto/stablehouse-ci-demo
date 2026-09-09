# Changesets

Run `yarn changeset` in a feature branch. It writes a **patch** file for each
changed app. Use `yarn changeset:minor` or `yarn changeset:major` for a higher
bump. Pass `-m "summary"` or answer the single Summary prompt.

```bash
yarn changeset
yarn changeset:minor -m "Add the account summary"
yarn changeset web -m "Web-only fix"
```

- Changes under `apps/web/**` target `web`.
- Changes under `apps/backoffice/**` target `backoffice`.
- Changes under `packages/common/**` need no hand-written shared changeset:
  trusted CI creates separate `patch` changesets for `web` and `backoffice`.
- Documentation and CI-only changes need no changeset.

Never target `common`. It stays at the required placeholder version `0.0.0` and
is never released, tagged, or included in a release branch.
