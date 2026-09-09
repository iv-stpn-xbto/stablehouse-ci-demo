# Stablehouse Changesets CI demo

This repository is a minimal end-to-end implementation of
[SHF-122](https://linear.app/xbtohub/issue/SHF-122/spec-changesets-on-develop-auto-releaseversion-main-backmerge).
It substitutes `backoffice` for the spec's second (`mobile`) app.

## Workspace

- `apps/web` — private, independently versioned static web app.
- `apps/backoffice` — private, independently versioned static backoffice app.
- `packages/common` — shared utility consumed by both apps; not released itself.

All packages are private. Releases update versions and changelogs only; nothing
is published to npm.

```bash
corepack enable
yarn install
yarn build
yarn test
```

The builds produce `apps/web/dist/index.html` and
`apps/backoffice/dist/index.html`.

## Branch topology

Only `develop` and `main` are permanent:

```text
feature + changeset -> develop
                         |
                         v
                 release/<version>
                         |
                         v
                        main
                         |
                         +---- backmerge PR ----> develop
```

`develop` is the integration branch and default feature PR base. `main` is
production. A `release/<version>` branch exists only while its Version Packages
PR is open and is deleted after merge.

`master`, manually dated release branches, and standing hotfix branches are not
part of this flow.

## Author a change

Make the code change and run:

```bash
yarn changeset
```

Select targets according to the scope:

| Changed code | Required targets |
| --- | --- |
| `apps/web/**` | `web` |
| `apps/backoffice/**` | `backoffice` |
| `packages/common/**` | `web` and `backoffice` |
| docs, workflows, repository config | none |

Choose `patch`, `minor`, or `major`; Changesets computes SemVer from those
entries. The PR gate checks that changesets cover all affected apps. Shared code
targets both consumers explicitly so a web-only release never bumps backoffice,
and vice versa.

Example shared changeset:

```md
---
"web": minor
"backoffice": minor
---

Improve the shared environment formatter.
```

## Ship a release

1. Merge feature PRs and their `.changeset/*.md` files into `develop`.
2. `.github/workflows/release.yml` runs the stock `changesets/action`.
3. The action versions packages, creates changelogs, consumes changesets, and
   opens or updates one PR into `main`.
4. A thin wrapper renames the action's temporary branch to the computed
   `release/<version>`. If more changesets land, it restores the temporary name,
   updates the same PR, and renames it to the newly computed version.
5. Merge the Version Packages PR to ship the `develop` code and matching
   versions together.
6. `.github/workflows/backmerge.yml` deletes the release branch and opens a
   `main` to `develop` PR. It enables auto-merge when the repository permits it.
   Conflicts leave a visible PR for a human; no workflow force-pushes.

When both apps change, the web version is the train identifier. A
backoffice-only release uses its version. The PR body always lists both package
versions.

No pending changesets means no release PR. The post-release backmerge therefore
does not start another release cycle.

## GitHub setup

Bootstrap and protect the branches after the initial commit:

```bash
git push -u origin main
git switch -c develop
git push -u origin develop
```

Recommended repository settings:

1. Make `develop` the default branch.
2. Require the `CI / verify` check on `develop` and `main`.
3. Require pull requests on both permanent branches.
4. Enable auto-merge and automatically delete head branches.
5. Allow GitHub Actions to create pull requests.
6. Add a fine-grained `RELEASE_BOT_TOKEN` Actions secret with repository
   contents and pull-request write access.

The workflows fall back to `GITHUB_TOKEN`, but GitHub suppresses some follow-up
workflow events for changes created with that token. A GitHub App or fine-grained
bot token is recommended for the fully automatic demo. Never commit the token.

## CI implementation notes

- External Actions are pinned to immutable commit SHAs.
- The release action runs on `develop` but sets its PR base to `main`.
- Its release commit is based on the triggering `develop` SHA, so the single PR
  contains product code and the corresponding generated versions.
- The wrapper validates repository names, PR numbers, branch names, and SemVer
  before GitHub writes.
- Backmerge uses `main` directly as the PR head, preserving the production merge
  commit without introducing another branch.

Run the local verification suite with:

```bash
yarn install --frozen-lockfile
yarn build
yarn test
```
