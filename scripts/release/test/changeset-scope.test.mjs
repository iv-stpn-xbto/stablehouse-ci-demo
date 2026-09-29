import test from "node:test";
import assert from "node:assert/strict";
import {
  changesetTargets,
  needsWebChangeset,
  isSharedOnlyChange,
  validationErrors,
  generatedChangeset,
  generatedFileName,
  assertWritableHeadBranch,
  changesetMarkdown,
  parseAddArgs,
} from "../changesets.mjs";

const changeset = (targets) => `---
${Object.entries(targets).map(([name, type]) => `"${name}": ${type}`).join("\n")}
---

Change
`;

test("changeset CLI parses bump and summary", () => {
  assert.deepEqual(parseAddArgs(["patch"]), { bump: "patch", summary: undefined });
  assert.deepEqual(parseAddArgs(["minor", "-m", "Add heading"]), {
    bump: "minor",
    summary: "Add heading",
  });
  assert.deepEqual(parseAddArgs(["patch", "web", "-m", "ok"]), {
    bump: "patch",
    summary: "ok",
  });
});

test("authored changesets target web only", () => {
  assert.match(changesetMarkdown("patch", "Update heading"), /"web": patch/);
});

test("product paths require a web changeset", () => {
  assert.equal(needsWebChangeset(["apps/web/src/render.js"]), true);
  assert.equal(needsWebChangeset(["packages/common/src/index.js"]), true);
  assert.equal(needsWebChangeset(["README.md"]), false);
  assert.equal(needsWebChangeset([".github/workflows/x.yaml"]), false);
});

test("shared-only detection excludes web", () => {
  assert.equal(isSharedOnlyChange(["packages/common/src/index.js"]), true);
  assert.equal(
    isSharedOnlyChange([
      "packages/common/src/index.js",
      "apps/web/src/render.js",
    ]),
    false,
  );
});

test("validation accepts a web changeset for app changes", () => {
  assert.deepEqual(
    validationErrors(
      ["apps/web/src/render.js"],
      [{ path: ".changeset/a.md", contents: changeset({ web: "patch" }) }],
      1,
    ),
    [],
  );
});

test("validation rejects missing web changeset on product paths", () => {
  assert.deepEqual(
    validationErrors(["packages/common/src/index.js"], [], 1),
    ["Changed versioned code is missing a web changeset"],
  );
});

test("validation rejects unknown package targets", () => {
  assert.deepEqual(
    validationErrors(
      [],
      [{ path: ".changeset/bad.md", contents: changeset({ common: "patch" }) }],
      1,
    ),
    [
      '.changeset/bad.md targets unknown package common; only "web" is versioned',
    ],
  );
});

test("generated shared changeset targets web patch", () => {
  assert.match(generatedChangeset("Improve shared formatting"), /"web": patch/);
  assert.equal(generatedFileName(42), ".changeset/shared-pr-42.md");
});

test("shared changeset refuses permanent heads", () => {
  assert.throws(() => assertWritableHeadBranch("main"), /permanent branch/);
  assert.throws(() => assertWritableHeadBranch("develop"), /permanent branch/);
  assert.throws(() => assertWritableHeadBranch("refs/heads/main"), /permanent branch/);
  assert.equal(assertWritableHeadBranch("feat/demo-1-example"), "feat/demo-1-example");
});

test("invalid changeset frontmatter does not satisfy the gate", () => {
  assert.deepEqual([...changesetTargets("---\nweb: banana\n---\n")], []);
});
