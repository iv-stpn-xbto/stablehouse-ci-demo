# Changesets

Run `yarn changeset` on a feature branch. It writes a **patch** web changeset.
Use `yarn changeset:minor` or `yarn changeset:major` for a higher bump.
Pass `-m "summary"` or answer the Summary prompt.

```bash
yarn changeset
yarn changeset:minor -m "Add the account summary"
```

- Changes under `apps/web/**` need a web changeset.
- Changes under `packages/common/**` get a generated `web: patch` changeset from
  CI (`.changeset/shared-pr-<PR>.md`).
- Documentation and CI-only changes need no changeset unless you want a chore
  release (develop→`release/X.X.X` will patch-bump when there are commit diffs
  and no changesets).

Never target `common`. It stays at `0.0.0` and is never released.
