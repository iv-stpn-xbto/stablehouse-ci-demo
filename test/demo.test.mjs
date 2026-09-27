import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  changesetTargets,
  needsWebChangeset,
  validationErrors,
} from "../scripts/check-changeset-scope.mjs";
import {
  backmergeBranch,
  bumpVersion,
  highestBump,
  hotfixBranch,
  parseVersionedBranch,
  releaseBranch,
} from "../scripts/release-policy.mjs";
import {
  generatedChangeset,
  generatedFileName,
} from "../scripts/common-changesets.mjs";
import { changesetMarkdown, parseAddArgs } from "../scripts/add-changeset.mjs";
import { computeNextVersion, pendingWebBumps } from "../scripts/compute-version.mjs";
import { renderPage as renderWeb } from "../apps/web/src/render.js";

const changeset = (targets) => `---
${Object.entries(targets).map(([name, type]) => `"${name}": ${type}`).join("\n")}
---

Demo change
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

test("web app consumes the shared utility", () => {
  assert.match(renderWeb(), /Environment: Demo/);
  assert.match(renderWeb("production"), /Environment: Production/);
});

test("web and common paths require a web changeset", () => {
  assert.equal(needsWebChangeset(["apps/web/src/render.js"]), true);
  assert.equal(needsWebChangeset(["packages/common/src/index.js"]), true);
  assert.equal(needsWebChangeset(["README.md"]), false);
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

test("common validation requires the generated web file", () => {
  assert.deepEqual(
    validationErrors(
      ["packages/common/src/index.js"],
      [{ path: ".changeset/manual.md", contents: changeset({ web: "patch" }) }],
      42,
    ),
    [".changeset/common-pr-42.md must contain a generated web: patch release"],
  );

  assert.deepEqual(
    validationErrors(
      ["packages/common/src/index.js"],
      [
        {
          path: generatedFileName(42),
          contents: generatedChangeset("Improve shared formatting"),
        },
      ],
      42,
    ),
    [],
  );
});

test("changesets cannot target common", () => {
  assert.deepEqual(
    validationErrors(
      [],
      [{ path: ".changeset/invalid.md", contents: changeset({ common: "patch" }) }],
      1,
    ),
    [".changeset/invalid.md must not version common"],
  );
});

test("invalid changeset frontmatter does not satisfy the gate", () => {
  assert.deepEqual([...changesetTargets("---\nweb: banana\n---\n")], []);
});

test("versioned branches use release|hotfix|backmerge/X.X.X", () => {
  assert.equal(releaseBranch("2.0.0"), "release/2.0.0");
  assert.equal(hotfixBranch("1.0.1"), "hotfix/1.0.1");
  assert.equal(backmergeBranch("1.2.3"), "backmerge/1.2.3");
  assert.deepEqual(parseVersionedBranch("release/2.1.0"), {
    kind: "release",
    version: "2.1.0",
  });
  assert.deepEqual(parseVersionedBranch("hotfix/1.0.1"), {
    kind: "hotfix",
    version: "1.0.1",
  });
});

test("semver helpers pick the highest bump", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.equal(highestBump(["patch", "minor"]), "minor");
  assert.equal(highestBump(new Set(["major", "patch"])), "major");
});

test("computeNextVersion uses changesets or falls back to patch", async () => {
  const bumps = await pendingWebBumps();
  const plan = await computeNextVersion({ hasCommitDiffs: true });
  assert.equal(typeof plan.version, "string");
  if (bumps.size > 0) {
    assert.equal(plan.source, "changesets");
  } else {
    assert.equal(plan.source, "patch-fallback");
  }
});

test("workspace manifests remain private", async () => {
  for (const path of ["apps/web/package.json", "packages/common/package.json"]) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    assert.equal(manifest.private, true, `${path} must not publish to npm`);
  }
  const common = JSON.parse(await readFile("packages/common/package.json", "utf8"));
  assert.equal(common.version, "0.0.0");
});
