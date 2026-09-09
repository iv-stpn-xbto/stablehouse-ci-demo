import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { changesetTargets, missingTargets, requiredPackagesForPaths } from "../scripts/check-changeset-scope.mjs";
import { selectTrainVersion } from "../scripts/release-policy.mjs";
import { renderPage as renderWeb } from "../apps/web/src/render.js";
import { renderPage as renderBackoffice } from "../apps/backoffice/src/render.js";

const changeset = (targets) => `---
${Object.entries(targets).map(([name, type]) => `"${name}": ${type}`).join("\n")}
---

Demo change
`;

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
  assert.deepEqual(
    missingTargets(["packages/common/src/index.js"], [changeset({ web: "patch" })]),
    ["backoffice"],
  );
  assert.deepEqual(
    missingTargets(
      ["packages/common/src/index.js"],
      [changeset({ web: "minor", backoffice: "minor" })],
    ),
    [],
  );
});

test("invalid changeset frontmatter does not satisfy the gate", () => {
  assert.deepEqual([...changesetTargets("---\nweb: banana\n---\n")], []);
});

test("web version is the train id when both apps change", () => {
  assert.equal(
    selectTrainVersion(
      new Set(["apps/web/package.json", "apps/backoffice/package.json"]),
      { web: "2.0.0", backoffice: "1.4.0" },
    ),
    "2.0.0",
  );
});

test("backoffice version is the train id for a backoffice-only release", () => {
  assert.equal(
    selectTrainVersion(
      new Set(["apps/backoffice/package.json"]),
      { web: "2.0.0", backoffice: "1.4.0" },
    ),
    "1.4.0",
  );
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
});
