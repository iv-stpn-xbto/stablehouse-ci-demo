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
    version: "4.1.6",
    bump: "patch",
    commits: [
      { hash: "abc1234", subject: "chore: tweak" },
      { hash: "def5678", subject: "fix: gate" },
    ],
  });
  assert.match(section, /^## 4\.1\.6$/m);
  assert.match(section, /### Patch Changes/);
  assert.match(section, /### Commits/);
  assert.match(section, /`abc1234` chore: tweak/);
});

test("upsertChangelog prepends a version and replaces duplicates", () => {
  const initial = `# frontend

## 4.1.5

### Patch Changes

- first
`;
  const next = upsertChangelog(
    initial,
    buildVersionSection({
      version: "4.1.6",
      bump: "patch",
      summaryLines: ["second"],
      commits: [{ hash: "aaa1111", subject: "chore: second" }],
    }),
    "4.1.6",
  );
  assert.match(next, /## 4\.1\.6[\s\S]*## 4\.1\.5/);
  const replaced = upsertChangelog(
    next,
    buildVersionSection({
      version: "4.1.6",
      bump: "patch",
      summaryLines: ["updated"],
      commits: [{ hash: "bbb2222", subject: "chore: updated" }],
    }),
    "4.1.6",
  );
  assert.equal((replaced.match(/## 4\.1\.6/g) ?? []).length, 1);
  assert.match(replaced, /updated/);
  assert.doesNotMatch(replaced, /second/);
});

test("attachCommitsToChangelog keeps prior notes", () => {
  const changelog = `# frontend

## 4.2.0

### Minor Changes

- ff20064: test
`;
  const updated = attachCommitsToChangelog(changelog, "4.2.0", [
    { hash: "ff20064", subject: "test" },
  ]);
  const section = extractVersionSection(updated, "4.2.0");
  assert.match(section, /### Minor Changes/);
  assert.match(section, /### Commits/);
  assert.match(section, /`ff20064` test/);
});

test("releasePullBody surfaces the changelog section", () => {
  const body = releasePullBody({
    version: "4.1.6",
    branch: "release/4.1.6",
    source: "patch-fallback",
    changelogSection:
      "## 4.1.6\n\n### Patch Changes\n\n- hello\n\n### Commits\n\n- `abcd123` chore: follow up\n",
  });
  assert.match(body, /### Changelog/);
  assert.match(body, /## 4\.1\.6/);
  assert.match(body, /backmerge\/4\.1\.6/);
});

test("formatCommitsMarkdown handles an empty list", () => {
  assert.match(formatCommitsMarkdown([]), /No non-merge commits/);
});
