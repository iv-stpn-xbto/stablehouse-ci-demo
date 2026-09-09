# Changesets

Run `yarn changeset` in a feature branch and commit the generated Markdown file.

- Changes under `apps/web/**` target `web`.
- Changes under `apps/backoffice/**` target `backoffice`.
- Changes under `packages/common/**` target both `web` and `backoffice`.
- Documentation and CI-only changes need no changeset.

`common` is deliberately not independently released. Its consumers carry the
release impact, which keeps web-only and backoffice-only releases independent.
