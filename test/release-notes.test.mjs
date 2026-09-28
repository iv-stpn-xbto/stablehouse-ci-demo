import test from "node:test";
import assert from "node:assert/strict";
import {
  attachCommitsToChangelog,
  buildVersionSection,
  extractVersionSection,
  formatCommitsMarkdown,
  releasePullBody,
  upsertChangelog,
} from "../scripts/release-notes.mjs";

test("buildVersionSection includes patch notes and commits", () => {
  const section = buildVersionSection({
    version: "1.2.3",
    bump: "patch",
    commits: [
      { hash: "abc1234", subject: "chore: tweak" },
      { hash: "def5678", subject: "fix: gate" },
    ],
  });
  assert.match(section, /^## 1\.2\.3$/m);
  assert.match(section, /### Patch Changes/);
  assert.match(section, /### Commits/);
  assert.match(section, /`abc1234` chore: tweak/);
  assert.match(section, /`def5678` fix: gate/);
});

test("upsertChangelog prepends a version and replaces duplicates", () => {
  const initial = `# web

## 1.0.0

### Patch Changes

- first
`;
  const next = upsertChangelog(
    initial,
    buildVersionSection({
      version: "1.0.1",
      bump: "patch",
      summaryLines: ["second"],
      commits: [{ hash: "aaa1111", subject: "chore: second" }],
    }),
    "1.0.1",
  );
  assert.match(next, /## 1\.0\.1[\s\S]*## 1\.0\.0/);
  const replaced = upsertChangelog(
    next,
    buildVersionSection({
      version: "1.0.1",
      bump: "patch",
      summaryLines: ["updated"],
      commits: [{ hash: "bbb2222", subject: "chore: updated" }],
    }),
    "1.0.1",
  );
  assert.equal((replaced.match(/## 1\.0\.1/g) ?? []).length, 1);
  assert.match(replaced, /updated/);
  assert.doesNotMatch(replaced, /second/);
});

test("attachCommitsToChangelog keeps changeset notes", () => {
  const changelog = `# web

## 1.1.0

### Minor Changes

- ff20064: test
`;
  const updated = attachCommitsToChangelog(changelog, "1.1.0", [
    { hash: "ff20064", subject: "test" },
  ]);
  const section = extractVersionSection(updated, "1.1.0");
  assert.match(section, /### Minor Changes/);
  assert.match(section, /ff20064: test/);
  assert.match(section, /### Commits/);
  assert.match(section, /`ff20064` test/);
});

test("releasePullBody surfaces the changelog section", () => {
  const body = releasePullBody({
    version: "1.1.2",
    branch: "release/1.1.2",
    source: "patch-fallback",
    changelogSection:
      "## 1.1.2\n\n### Patch Changes\n\n- hello\n\n### Commits\n\n- `abcd123` chore: follow up\n",
  });
  assert.match(body, /### Changelog/);
  assert.match(body, /## 1\.1\.2/);
  assert.match(body, /### Commits/);
  assert.match(body, /`abcd123` chore: follow up/);
  assert.equal((body.match(/### Commits/g) ?? []).length, 1);
});

test("formatCommitsMarkdown handles an empty list", () => {
  assert.match(formatCommitsMarkdown([]), /No non-merge commits/);
});
