import test from "node:test";
import assert from "node:assert/strict";
import {
  attachCommitsToChangelog,
  buildVersionSection,
  extractVersionSection,
  formatCommitsMarkdown,
  releasePullBody,
  upsertChangelog,
} from "../lib.mjs";

test("buildVersionSection includes patch notes and commits", () => {
  const section = buildVersionSection({
    version: "1.1.3",
    bump: "patch",
    commits: [
      { hash: "abc1234", subject: "chore: tweak" },
      { hash: "def5678", subject: "fix: gate" },
    ],
  });
  assert.match(section, /^## 1\.1\.3$/m);
  assert.match(section, /### Patch Changes/);
  assert.match(section, /### Commits/);
  assert.match(section, /`abc1234` chore: tweak/);
});

test("upsertChangelog prepends a version and replaces duplicates", () => {
  const initial = `# web

## 1.1.2

### Patch Changes

- first
`;
  const next = upsertChangelog(
    initial,
    buildVersionSection({
      version: "1.1.3",
      bump: "patch",
      summaryLines: ["second"],
      commits: [{ hash: "aaa1111", subject: "chore: second" }],
    }),
    "1.1.3",
  );
  assert.match(next, /## 1\.1\.3[\s\S]*## 1\.1\.2/);
  const replaced = upsertChangelog(
    next,
    buildVersionSection({
      version: "1.1.3",
      bump: "patch",
      summaryLines: ["updated"],
      commits: [{ hash: "bbb2222", subject: "chore: updated" }],
    }),
    "1.1.3",
  );
  assert.equal((replaced.match(/## 1\.1\.3/g) ?? []).length, 1);
  assert.match(replaced, /updated/);
  assert.doesNotMatch(replaced, /second/);
});

test("attachCommitsToChangelog keeps prior notes", () => {
  const changelog = `# web

## 1.2.0

### Minor Changes

- ff20064: test
`;
  const updated = attachCommitsToChangelog(changelog, "1.2.0", [
    { hash: "ff20064", subject: "test" },
  ]);
  const section = extractVersionSection(updated, "1.2.0");
  assert.match(section, /### Minor Changes/);
  assert.match(section, /### Commits/);
  assert.match(section, /`ff20064` test/);
});

test("releasePullBody surfaces the changelog section", () => {
  const body = releasePullBody({
    version: "1.1.3",
    branch: "release/1.1.3",
    source: "patch-fallback",
    changelogSection:
      "## 1.1.3\n\n### Patch Changes\n\n- hello\n\n### Commits\n\n- `abcd123` chore: follow up\n",
  });
  assert.match(body, /### Changelog/);
  assert.match(body, /## 1\.1\.3/);
  assert.match(body, /backmerge\/1\.1\.3/);
  assert.match(body, /web@1\.1\.3/);
});

test("formatCommitsMarkdown handles an empty list", () => {
  assert.match(formatCommitsMarkdown([]), /No non-merge commits/);
});
