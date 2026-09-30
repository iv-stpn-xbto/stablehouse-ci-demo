# Stablehouse release CI demo

Exact release-CI contract from `stablehouse-front-end-apps-MISC`
(`ci/shf-359-release-hotfix-backmerge-ci`): consolidated `scripts/release/` CLIs,
root `frontend` semver, ephemeral `release/` / `hotfix/` / `backmerge/` branches,
`github.token` auth, `workflow_dispatch` chaining, and API client swagger sync.

## Workspace

| Path | Role |
| --- | --- |
| Root `package.json` (`frontend`) | Sole versioned release package |
| `packages/web` | Web app |
| `packages/mobile-new` | Mobile stub (path-prefix parity) |
| `packages/common` | Shared package (never independently released) |
| `packages/universal-components` | UC stub (path-prefix parity) |
| `libs/api-client` (`@xbto/api-client`) | Swagger typings; synced on release/backmerge |

```bash
corepack enable
yarn install --immutable
yarn static:checks
```

## Branch flow

```text
feature PR (+ frontend changeset)
        │
        │ shared-only => CI adds frontend: patch (shared-pr-N)
        ▼
     develop
        │
        │ push → prepare release/X.X.X (main + develop, version, typings:prod)
        ▼
  release/X.X.X ──PR──▶ main
                          │
          yarn hotfix ────┤──▶ hotfix/X.X.X ──PR──▶ main
                          │
                          ▼
                   backmerge/X.X.X (+ typings:dev) ──PR──▶ develop
```

### Release / hotfix / backmerge

Same as MISC, with this demo's bump policy:

| Path | Bump |
| --- | --- |
| `yarn hotfix` | always **patch** from `origin/main` |
| `release/X.X.X` (prepare) | at least **minor** (patch changesets and chore diffs are floored up; major stays major) |

1. **Prepare release** — `node scripts/release/release.mjs prepare` then
   `typings:prod` sync commit when dirty; same-run smoke; chain status + guards.
2. **Complete** — tag `frontend@X.X.X`, delete ephemeral head, open
   `backmerge/X.X.X` with optional `typings:dev` sync.
3. **Hotfix** — `yarn hotfix -m "…"`.
4. Merge release/hotfix/backmerge with FF or merge commit — **never squash**.

### API client swagger sync

| Branch | Command | Commit |
| --- | --- | --- |
| `release/X.X.X` | `yarn workspace @xbto/api-client typings:prod` | `Sync API client from prod swagger` |
| `backmerge/X.X.X` | `yarn workspace @xbto/api-client typings:dev` | `Sync API client from dev swagger` |

Immediately after sync, prepare restores **env-stable paths** from the
destination permanent branch (`ENV_STABLE_PATHS` in `scripts/release/lib.mjs`):

| Flow | Restore source | Commit (when dirty) |
| --- | --- | --- |
| Release | `origin/main` | `Restore env-stable paths from main` |
| Backmerge | `origin/develop` | `Restore env-stable paths from develop` |

Current path: `packages/common/src/utils/factories`.

Showcase (from MISC #2439 / enrich-trade-currency factory):

| Branch | Behavior |
| --- | --- |
| `develop` | Maps `couponPercent`, `paymentFrequency`, `bidSpread`, `askSpread` (dev swagger) |
| `main` | Those four assignments are commented out (prod types) |

After release prepare syncs **prod** swagger, `restoreEnvStablePaths("origin/main")`
puts the prod factory back. After backmerge syncs **dev** swagger,
`restoreEnvStablePaths("origin/develop")` puts the develop factory back.

API typings match MISC: `typings:dev` / `typings:prod` fetch the env swagger URL
and overwrite the same `libs/api-client/swagger.json` (+ curated / generated
client) in place — no per-env fixture folders.

## Author changes

```bash
yarn changeset
yarn changeset:minor -m "Summary"
```

```md
---
"frontend": patch
---

Update the web heading.
```

## Workflows

| Workflow | Role |
| --- | --- |
| `prepare-release.yaml` | Create/rebase `release/X.X.X` |
| `complete-release-and-backmerge.yaml` | Tag + `backmerge/X.X.X` |
| `release-guards.yaml` | Scope, naming, uniqueness |
| `release-status.yaml` | Summary |
| `shared-changesets.yaml` | Auto frontend:patch for shared-only PRs |
| `web-app-develop-ci.yaml` | Product verify (build/tests; no AWS/ECR) |
| `web-app-staging-ci.yaml` / `web-app-prod-ci.yaml` | Dispatch stubs (build only) |

## Scripts

```bash
node scripts/release/changesets.mjs add <patch|minor|major> [-m summary]
node scripts/release/changesets.mjs check <base> [head]
node scripts/release/changesets.mjs shared

node scripts/release/release.mjs prepare|backmerge|complete|hotfix|status|enforce-uniqueness
```

## GitHub setup

1. Default branch `develop`.
2. Protect `develop` / `main`; require develop CI + release-guards as needed.
3. Allow GitHub Actions to create PRs (`github.token`).
4. Optional `YARN_NPM_AUTH_TOKEN` (unused by this demo's public deps; workflows
   pass it for MISC parity).

## Local verification

```bash
yarn install --immutable
yarn static:checks
node scripts/release/release.mjs status
```

### Remaining demo-only deltas vs MISC

- Product `web-app-*-ci` workflows skip AWS OIDC/ECR deploy.
- `@xbto/api-client` typings use a lightweight generator (same yarn script names
  and in-place `swagger.json` overwrite) instead of NSwag + .NET.
- No `tools/*` / `packages/mobile` workspaces.
