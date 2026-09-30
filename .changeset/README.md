# Changesets

Run `yarn changeset` on a feature branch. It writes a **patch** frontend changeset.
Use `yarn changeset:minor` or `yarn changeset:major` for a higher bump.
Pass `-m "summary"` or answer the Summary prompt.

```bash
yarn changeset
yarn changeset:minor -m "Add the account summary"
```

- Changes under `packages/web/**`, `packages/mobile-new/**`, `packages/common/**`,
  `packages/universal-components/**`, or `libs/**` need a frontend changeset.
- Shared-only PRs (no web/mobile-new) get `.changeset/shared-pr-<PR>.md` from CI.
- Documentation and CI-only changes need no changeset unless you want a chore
  release (develop→`release/X.X.X` still **minor**-bumps when there are commit
  diffs and no changesets). Patch is reserved for `yarn hotfix`.

Only the root `frontend` package is versioned. Workspace packages stay private
and are not released independently.
