# Stablehouse release CI demo

Mirrors the release CI contract from `stablehouse-front-end-apps-MISC`:
consolidated `scripts/release/` CLIs, ephemeral `release/X.X.X` /
`hotfix/X.X.X` / `backmerge/X.X.X` branches, `github.token` auth, and
`workflow_dispatch` chaining for follow-up checks.

Single-app workspace: versioned `web`, unversioned `common`.

## Workspace

- `apps/web` — private, versioned app (`web@X.X.X` tags).
- `packages/common` — shared source used by web, never versioned or released.

`common` stays at `0.0.0`. CI rejects changesets targeting it. Nothing publishes
to npm.

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
yarn test
yarn test:release-ci
```

## Branch flow

Only `develop` and `main` are permanent.

```text
feature PR (+ web changeset)
        │
        │ common-only => CI adds web: patch changeset (shared-pr-N)
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

On every push to `develop` or `main`, `prepare-release.yaml` runs
`node scripts/release/release.mjs prepare`:

1. Require at least one commit on `develop` that is not in `main`, plus a tree
   diff or pending changesets. Otherwise clear any `release/*` branch/PR and
   exit.
2. Rebuild from latest `main`, merge `develop`, and compute `X.X.X` from pending
   web changesets (or patch fallback when there is a tree diff).
3. Bump `apps/web/package.json`, update `apps/web/CHANGELOG.md`, clear consumed
   changesets, force-push the sole `release/X.X.X`, and open/update its PR into
   `main`.
4. Same-run `yarn test:release-ci`, verify the branch tip, then chain
   `release-status` + `release-guards` via `workflow_dispatch` (GITHUB_TOKEN
   pushes do not retrigger push/PR workflows).

### Hotfix (`hotfix/X.X.X`)

```bash
yarn hotfix -m "Fix checkout timeout"
# or: yarn hotfix --no-push
```

Patch-bumps from `origin/main`, force-pushes `hotfix/X.X.X`, and opens a PR
into `main` when a token is available.

### Backmerge (`backmerge/X.X.X`)

After a `release/*` or `hotfix/*` PR merges into `main` (and on every push to
`main`), `complete-release-and-backmerge.yaml`:

1. Tags `web@X.X.X` and deletes the merged ephemeral branch.
2. Rebuilds exactly one `backmerge/X.X.X` from the tip of `main`.
3. Opens/updates the PR into `develop` for a human to approve and merge
   (never squash; never auto-merge).
4. Same-run smoke + chains follow-up workflows when not skipped.

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
| `packages/common/**` | CI generates `.changeset/shared-pr-<PR>.md` with `web: patch` |
| Docs/workflows/config only | No changeset (release still patch-bumps if develop differs from main) |

## Workflows

| Workflow | Role |
| --- | --- |
| `prepare-release.yaml` | Create/rebase `release/X.X.X` |
| `complete-release-and-backmerge.yaml` | Tag + open/rebase `backmerge/X.X.X` |
| `release-guards.yaml` | Changeset scope, naming, uniqueness |
| `release-status.yaml` | Release summary |
| `shared-changesets.yaml` | Auto web:patch for common-only PRs |
| `ci.yml` | Build + tests (product verify) |

## Scripts

```bash
node scripts/release/changesets.mjs add <patch|minor|major> [-m summary]
node scripts/release/changesets.mjs check <base> [head]
node scripts/release/changesets.mjs shared

node scripts/release/release.mjs prepare
node scripts/release/release.mjs backmerge
node scripts/release/release.mjs complete
node scripts/release/release.mjs hotfix ...
node scripts/release/release.mjs status
node scripts/release/release.mjs enforce-uniqueness
```

## GitHub setup

1. Keep `develop` as the default branch.
2. Protect `develop` and `main`; require `CI / verify` and `release-guards`
   where appropriate. Dispatched `release-guards` runs may need to satisfy
   required checks on ephemeral PRs (GITHUB_TOKEN pushes alone do not fire the
   usual PR check path).
3. Allowed heads into `main`: `release/X.X.X`, `hotfix/X.X.X`.
4. Enable **Allow GitHub Actions to create and approve pull requests** so
   `github.token` can open release / backmerge PRs.
5. No bot PAT required — workflows use `github.token` only.

## Local verification

```bash
yarn install --frozen-lockfile
yarn build
yarn test
yarn test:release-ci
node scripts/release/release.mjs status
```

Demo adaptations vs MISC: versions `web` under `apps/web` (not root
`frontend`); API client typings sync is a no-op; yarn classic
`--frozen-lockfile` instead of `--immutable`.
