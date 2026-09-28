# Stablehouse release CI demo

Single-app (`web`) Changesets demo with ephemeral `release/X.X.X`,
`hotfix/X.X.X`, and `backmerge/X.X.X` branches. At most one branch of each kind
exists at a time.

## Workspace

- `apps/web` — private, versioned app.
- `packages/common` — shared source used by web, never versioned or released.

`common` stays at `0.0.0`. CI rejects changesets targeting it. Nothing publishes
to npm.

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
yarn test
```

## Branch flow

Only `develop` and `main` are permanent.

```text
feature PR (+ web changeset)
        │
        │ common code => CI adds web: patch changeset
        ▼
     develop
        │
        │ push → prepare release/X.X.X from main + develop, then version
        ▼
  release/X.X.X ──PR──▶ main
                          │
          yarn hotfix ────┤──▶ hotfix/X.X.X ──PR──▶ main
                          │
                          ▼
                   backmerge/X.X.X ──PR──▶ develop
```

### Release (`release/X.X.X`)

On every push to `develop` or `main`, `release.yml` runs
`scripts/prepare-release.mjs`:

1. Require at least one commit on `develop` that is not in `main`, plus a tree
   diff or pending changesets. Otherwise clear any `release/*` branch/PR and
   exit (so a merged release does not reopen until develop moves again).
2. Rebuild from latest `main`, merge `develop`, and compute `X.X.X`:
   - from pending web changesets (highest of major/minor/patch), or
   - the next **patch** when there are commit diffs but no changesets
     (chores / hotfixes-style landings on develop).
3. Apply the version (`changeset version`, or a direct `package.json` bump) and
   update `apps/web/CHANGELOG.md` with release notes plus the list of commits
   from `main..develop`.
4. Force-push exactly one `release/X.X.X` branch and open/update its PR into
   `main` (PR body includes the changelog section and commit list). Any other
   `release/*` branch/PR is closed and deleted.
5. After merge, CI tags `web@X.X.X` and publishes a GitHub Release whose body is
   that changelog section.

### Hotfix (`hotfix/X.X.X`)

From a clean worktree:

```bash
yarn hotfix -m "Fix checkout timeout"
# or: yarn hotfix --no-push
```

The CLI:

1. Reads `web` version from `origin/main`.
2. Creates `hotfix/X.X.X` with a **+1 patch** bump in `apps/web/package.json`.
3. Force-pushes that branch (unless `--no-push`), keeps it the only `hotfix/*`,
   and opens a PR into `main` when `GITHUB_TOKEN` / `GH_TOKEN` is available.

Add fix commits on the branch before merging.

### Backmerge (`backmerge/X.X.X`)

After a `release/*` or `hotfix/*` PR merges into `main` (and on every push to
`main`), `backmerge.yml`:

1. Tags `web@X.X.X` and deletes the merged ephemeral branch.
2. Rebuilds exactly one `backmerge/X.X.X` from the tip of `main` (so a later
   hotfix rebases/renames the open backmerge automatically).
3. Opens/updates the PR into `develop` for a human to approve and merge.

## Author changes

```bash
yarn changeset                 # patch (default)
yarn changeset:minor           # minor
yarn changeset:major           # major
yarn changeset -m "Summary"    # skip the summary prompt
```

```md
---
"web": patch
---

Update the web heading.
```

| Changed code | Required behavior |
| --- | --- |
| `apps/web/**` | Author a web changeset |
| `packages/common/**` | CI generates `.changeset/common-pr-<PR>.md` with `web: patch` |
| Docs/workflows/config only | No changeset (release still patch-bumps if develop differs from main) |

## GitHub setup

1. Keep `develop` as the default branch.
2. Protect `develop` and `main`; require the `CI / verify` check.
3. Allowed heads into `main`: `release/X.X.X`, `hotfix/X.X.X`.
4. Enable GitHub Actions to create PRs. Backmerge PRs are left for human approval.
5. Add a least-privilege `RELEASE_BOT_TOKEN` with Contents and Pull requests
   write access so bot pushes retrigger workflows.

## Local verification

```bash
yarn install --frozen-lockfile
yarn build
yarn test
node scripts/release-status.mjs
```

External GitHub Actions are pinned to immutable commit SHAs.
