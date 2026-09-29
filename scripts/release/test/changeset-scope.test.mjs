import test from "node:test";
import assert from "node:assert/strict";
import {
  changesetTargets,
  needsFrontendChangeset,
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
  assert.deepEqual(parseAddArgs(["patch", "frontend", "-m", "ok"]), {
    bump: "patch",
    summary: "ok",
  });
});

test("authored changesets target frontend only", () => {
  assert.match(changesetMarkdown("patch", "Update heading"), /"frontend": patch/);
});

test("product paths require a frontend changeset", () => {
  assert.equal(needsFrontendChangeset(["packages/web/src/App.tsx"]), true);
  assert.equal(needsFrontendChangeset(["packages/mobile-new/App.tsx"]), true);
  assert.equal(needsFrontendChangeset(["packages/common/src/index.ts"]), true);
  assert.equal(
    needsFrontendChangeset(["packages/universal-components/src/Button.tsx"]),
    true,
  );
  assert.equal(needsFrontendChangeset(["libs/shared/src/index.ts"]), true);
  assert.equal(needsFrontendChangeset(["README.md"]), false);
  assert.equal(needsFrontendChangeset([".github/workflows/x.yaml"]), false);
  assert.equal(needsFrontendChangeset([".cursor/skills/x/SKILL.md"]), false);
});

test("shared-only detection excludes web and mobile-new", () => {
  assert.equal(isSharedOnlyChange(["libs/api-client/src/api.ts"]), true);
  assert.equal(
    isSharedOnlyChange([
      "packages/common/src/x.ts",
      "packages/web/src/App.tsx",
    ]),
    false,
  );
});

test("validation accepts a frontend changeset for app changes", () => {
  assert.deepEqual(
    validationErrors(
      ["packages/web/src/App.tsx"],
      [{ path: ".changeset/a.md", contents: changeset({ frontend: "patch" }) }],
      1,
    ),
    [],
  );
});

test("validation rejects missing frontend changeset on product paths", () => {
  assert.deepEqual(
    validationErrors(["libs/shared/src/index.ts"], [], 1),
    ["Changed versioned code is missing a frontend changeset"],
  );
});

test("validation rejects unknown package targets", () => {
  assert.deepEqual(
    validationErrors(
      [],
      [{ path: ".changeset/bad.md", contents: changeset({ web: "patch" }) }],
      1,
    ),
    [
      '.changeset/bad.md targets unknown package web; only "frontend" is versioned',
    ],
  );
});

test("generated shared changeset targets frontend patch", () => {
  assert.match(generatedChangeset("Improve shared formatting"), /"frontend": patch/);
  assert.equal(generatedFileName(42), ".changeset/shared-pr-42.md");
});

test("shared changeset refuses permanent heads", () => {
  assert.throws(() => assertWritableHeadBranch("main"), /permanent branch/);
  assert.throws(() => assertWritableHeadBranch("develop"), /permanent branch/);
  assert.throws(() => assertWritableHeadBranch("refs/heads/main"), /permanent branch/);
  assert.equal(assertWritableHeadBranch("feat/shf-1-example"), "feat/shf-1-example");
  assert.equal(assertWritableHeadBranch("ci/shf-359-x"), "ci/shf-359-x");
});

test("invalid changeset frontmatter does not satisfy the gate", () => {
  assert.deepEqual([...changesetTargets("---\nfrontend: banana\n---\n")], []);
});
