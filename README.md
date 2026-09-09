# Stablehouse per-app release CI demo

This repository demonstrates the revised
[SHF-122](https://linear.app/xbtohub/issue/SHF-122/spec-per-app-changesets-releases-from-main-with-develop-promotion)
flow. The production spec uses `web` and `mobile`; this small demo substitutes
`backoffice` for `mobile`.

## Workspace

- `apps/web` — private, independently versioned app.
- `apps/backoffice` — private, independently versioned app.
- `packages/common` — shared source used by both apps, never versioned or released.

`common` has the package-manager placeholder version `0.0.0`. CI rejects
changesets targeting it. All packages are private and nothing publishes to npm.

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
yarn test
```

## What main means

`main` contains tested code that is **eligible** to release. It does not claim
that every app is currently running that code.

Actual production state is app-specific:

- `web@<version>` plus the `production-web` GitHub Environment.
- `backoffice@<version>` plus the `production-backoffice` Environment.

The Release status workflow shows each app's version on `main`, latest tag,
pending changesets, and app/shared files changed since that tag. This makes
“merged but not released for this app” visible.

## Branch and PR flow

Only `develop` and `main` are permanent branches.

```text
feature PR (+ app changeset)
        │
        │ common code => CI adds one patch changeset per consumer
        ▼
     develop
        │
        │ Promote develop to main PR
        ▼
       main (eligible)
        ├── release/web/<version> ──────> web@<version>
        └── release/backoffice/<version> -> backoffice@<version>
                                               │
                 main -> develop backmerge PR <─┘
```

The promote PR uses `develop` directly as its head; no `promote/*` branch is
created. Release branches are ephemeral and version-only.

## Author changes

For app-only work:

```bash
yarn changeset                 # patch (default)
yarn changeset:minor           # minor
yarn changeset:major           # major
yarn changeset -m "Summary"    # skip the summary prompt
yarn changeset web             # force the package if git inference is unclear
```

The command infers `web` and/or `backoffice` from your diff vs `develop` and
writes **one file per app**. It never opens the stock major/minor/patch wizard.

```md
---
"web": patch
---

Update the web heading.
```

### Common changes

Do not author a changeset for `common`. The trusted
`common-changesets.yml` workflow detects `packages/common/**` in PRs to
`develop` and commits two deterministic entries:

- `.changeset/common-pr-<PR>-web.md` containing `web: patch`
- `.changeset/common-pr-<PR>-backoffice.md` containing `backoffice: patch`

Both use the sanitized PR title in their changelog summary. Reruns update the
same files rather than duplicating them. If the common change is removed from
the PR, CI removes the generated entries.

The automation uses `pull_request_target` only to execute scripts from the
trusted base SHA. It never checks out or executes PR code. It writes only to
same-repository branches through the GitHub Contents API.

| Changed code | Required behavior |
| --- | --- |
| `apps/web/**` | Author one changeset targeting `web` |
| `apps/backoffice/**` | Author one changeset targeting `backoffice` |
| `packages/common/**` | CI generates separate patch entries for both apps |
| Docs/workflows/config only | No app changeset |

The PR gate fails for missing app entries, multi-app changeset files, missing
generated common entries, or any attempt to version `common`.

## Promote and release

1. Feature PRs merge into `develop`.
2. `promote.yml` opens or reuses `develop` → `main` as
   **Promote develop to main**.
3. Reviewers merge it after normal checks. Code and pending changesets are now
   eligible, but no app deployment is implied.
4. On `main`, `release.yml` evaluates web and backoffice separately.
5. For each app with pending entries, stock `changesets/action` runs
   `changeset version` while ignoring the other app.
6. The thin wrapper keeps one PR per app and names it
   `release/<app>/<computed-version>`. A new computed version renames only that
   app's branch.
7. Merge whichever app is ready. The other app's changesets remain pending.
8. `backmerge.yml` verifies the app/package version, creates
   `<app>@<version>` at the merge commit, records its production Environment,
   deletes the ephemeral branch, and opens/reuses `main` → `develop`.

Conflicts remain in visible PRs. No workflow force-pushes through conflicts.

## Why the app release jobs are serialized

`changesets/action` supports one stock temporary branch,
`changeset-release/main`. It does not natively create separate release lines.
The matrix processes apps one at a time:

1. Restore that app's named branch to the stock temporary name.
2. Let the stock action update its PR using app-filtered versioning.
3. Rename it back to `release/<app>/<version>`.

This preserves Changesets as the version/changelog engine while preventing the
two jobs from racing over the temporary branch.

## GitHub setup

Recommended repository settings:

1. Keep `develop` as the default branch.
2. Protect `develop` and `main`; require the `CI / verify` check.
3. Require PRs for `main`. Allowed happy-path heads are `develop` and
   `release/<app>/<version>`.
4. Enable GitHub Actions to create PRs and optionally enable auto-merge.
5. Add a least-privilege `RELEASE_BOT_TOKEN` with Contents and Pull requests
   write access.

The workflows fall back to `GITHUB_TOKEN`, but GitHub suppresses follow-up
workflow events caused by that token. A GitHub App or fine-grained bot token is
needed for the fully automatic common-changeset and PR chain. Never commit it.

## Local verification

```bash
yarn install --frozen-lockfile
yarn build
yarn test
node scripts/release-status.mjs
```

External GitHub Actions are pinned to immutable commit SHAs.
