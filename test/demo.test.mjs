import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  changesetTargets,
  missingTargets,
  requiredPackagesForPaths,
  validationErrors,
} from "../scripts/check-changeset-scope.mjs";
import { appFromReleaseBranch, releaseBranch } from "../scripts/release-policy.mjs";
import {
  generatedChangeset,
  generatedFileName,
} from "../scripts/common-changesets.mjs";
import {
  appsFromChangedPaths,
  changesetMarkdown,
  parseAddArgs,
} from "../scripts/add-changeset.mjs";
import { renderPage as renderWeb } from "../apps/web/src/render.js";
import { renderPage as renderBackoffice } from "../apps/backoffice/src/render.js";

const changeset = (targets) => `---
${Object.entries(targets).map(([name, type]) => `"${name}": ${type}`).join("\n")}
---

Demo change
`;

test("changeset CLI defaults parse as patch and accepts explicit apps", () => {
  assert.deepEqual(parseAddArgs(["patch"]), { bump: "patch", apps: [], summary: undefined });
  assert.deepEqual(parseAddArgs(["minor", "web", "-m", "Add heading"]), {
    bump: "minor",
    apps: ["web"],
    summary: "Add heading",
  });
});

test("changeset inference uses app paths and ignores common-only diffs", () => {
  assert.deepEqual(appsFromChangedPaths(["apps/web/src/render.js"]), {
    apps: ["web"],
    touchesCommon: false,
    touchesApp: true,
  });
  assert.equal(
    appsFromChangedPaths(["packages/common/src/index.js"]).touchesCommon,
    true,
  );
});

test("authored changesets are one app per file", () => {
  assert.match(changesetMarkdown("web", "patch", "Update heading"), /"web": patch/);
});

test("minimal apps consume the shared utility", () => {
  assert.match(renderWeb(), /Environment: Demo/);
  assert.match(renderBackoffice("production"), /Environment: Production/);
});

test("web-only code requires only web", () => {
  assert.deepEqual([...requiredPackagesForPaths(["apps/web/src/render.js"])], ["web"]);
  assert.deepEqual(missingTargets(["apps/web/src/render.js"], [changeset({ web: "patch" })]), []);
  assert.deepEqual(missingTargets(["apps/web/src/render.js"], []), ["web"]);
});

test("backoffice-only code requires only backoffice", () => {
  assert.deepEqual(
    missingTargets(
      ["apps/backoffice/src/render.js"],
      [changeset({ backoffice: "minor" })],
    ),
    [],
  );
});

test("common code requires both consumers", () => {
  const entries = ["web", "backoffice"].map((app) => ({
    path: generatedFileName(42, app),
    contents: generatedChangeset(app, "Improve shared formatting"),
  }));
  assert.deepEqual(
    validationErrors(["packages/common/src/index.js"], entries, 42),
    [],
  );
});

test("common validation requires deterministic generated files", () => {
  assert.deepEqual(
    validationErrors(
      ["packages/common/src/index.js"],
      [{ path: ".changeset/manual.md", contents: changeset({ web: "patch" }) }],
      42,
    ),
    [
      "Changed versioned code is missing changeset targets: backoffice",
      ".changeset/common-pr-42-web.md must contain a generated web: patch release",
      ".changeset/common-pr-42-backoffice.md must contain a generated backoffice: patch release",
    ],
  );
});

test("changesets cannot target common or multiple apps", () => {
  const entries = [
    {
      path: ".changeset/invalid.md",
      contents: changeset({ web: "minor", backoffice: "patch", common: "patch" }),
    },
  ];
  assert.deepEqual(validationErrors([], entries, 1), [
    ".changeset/invalid.md must not version common",
    ".changeset/invalid.md targets multiple apps; use one changeset file per app",
  ]);
});

test("invalid changeset frontmatter does not satisfy the gate", () => {
  assert.deepEqual([...changesetTargets("---\nweb: banana\n---\n")], []);
});

test("release branches are app-scoped", () => {
  assert.equal(releaseBranch("web", "2.0.0"), "release/web/2.0.0");
  assert.equal(
    releaseBranch("backoffice", "1.4.0"),
    "release/backoffice/1.4.0",
  );
});

test("release branches parse app and version", () => {
  assert.deepEqual(appFromReleaseBranch("release/web/2.1.0"), {
    app: "web",
    version: "2.1.0",
  });
});

test("workspace manifests remain private", async () => {
  for (const path of [
    "apps/web/package.json",
    "apps/backoffice/package.json",
    "packages/common/package.json",
  ]) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    assert.equal(manifest.private, true, `${path} must not publish to npm`);
  }
  const common = JSON.parse(await readFile("packages/common/package.json", "utf8"));
  assert.equal(common.version, "0.0.0");
});
