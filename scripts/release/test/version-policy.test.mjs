import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPermanentBaseBranch,
  bumpVersion,
  highestBump,
  isVersionedBranch,
  parseVersionedBranch,
  pendingWebBumps,
  PERMANENT_BASE_BRANCHES,
  releaseBranch,
  hotfixBranch,
  backmergeBranch,
} from "../lib.mjs";
import { shouldPrepareRelease } from "../release.mjs";

test("assertPermanentBaseBranch allowlists only main and develop", () => {
  assert.deepEqual([...PERMANENT_BASE_BRANCHES], ["main", "develop"]);
  assert.equal(assertPermanentBaseBranch("main"), "main");
  assert.equal(assertPermanentBaseBranch("develop"), "develop");
  assert.throws(() => assertPermanentBaseBranch("staging"), /main or develop/);
  assert.throws(() => assertPermanentBaseBranch("main\n"), /main or develop/);
  assert.throws(() => assertPermanentBaseBranch("refs/heads/main"), /main or develop/);
  assert.throws(() => assertPermanentBaseBranch(""), /main or develop/);
  assert.throws(() => assertPermanentBaseBranch(undefined), /main or develop/);
  assert.throws(() => assertPermanentBaseBranch(null), /main or develop/);
});

test("pendingWebBumps collects intended release types", async () => {
  const root = await mkdtemp(join(tmpdir(), "sh-bumps-"));
  const dir = join(root, ".changeset");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "a.md"),
    `---
"web": patch
---

A
`,
    "utf8",
  );
  await writeFile(
    join(dir, "b.md"),
    `---
"web": minor
---

B
`,
    "utf8",
  );
  await writeFile(join(dir, "README.md"), "ignore", "utf8");

  const bumps = await pendingWebBumps(dir);
  assert.deepEqual([...bumps].sort(), ["minor", "patch"]);
  assert.equal(highestBump(bumps), "minor");
  assert.equal(bumpVersion("1.1.2", highestBump(bumps)), "1.2.0");
  await rm(root, { recursive: true, force: true });
});

test("isVersionedBranch rejects legacy per-app release names", () => {
  assert.equal(isVersionedBranch("release/1.1.3"), true);
  assert.equal(isVersionedBranch("release/web/1.1.3"), false);
  assert.equal(isVersionedBranch("hotfix/1.1.3", "hotfix"), true);
  assert.equal(isVersionedBranch("hotfix/1.1.3", "release"), false);
  assert.throws(() => parseVersionedBranch("release/web/1.0.0"));
});

test("versioned branches use release|hotfix|backmerge/X.X.X", () => {
  assert.equal(releaseBranch("1.2.0"), "release/1.2.0");
  assert.equal(hotfixBranch("1.1.3"), "hotfix/1.1.3");
  assert.equal(backmergeBranch("1.1.3"), "backmerge/1.1.3");
  assert.deepEqual(parseVersionedBranch("release/1.2.0"), {
    kind: "release",
    version: "1.2.0",
  });
});

test("semver helpers pick the highest bump", () => {
  assert.equal(bumpVersion("1.1.2", "patch"), "1.1.3");
  assert.equal(bumpVersion("1.1.2", "minor"), "1.2.0");
  assert.equal(bumpVersion("1.1.2", "major"), "2.0.0");
  assert.equal(highestBump(["patch", "minor"]), "minor");
  assert.equal(highestBump(new Set(["major", "patch"])), "major");
});

test("release preparation requires develop commits ahead of main", () => {
  assert.equal(
    shouldPrepareRelease({
      commitsAhead: 0,
      hasTreeDiff: true,
      hasChangesets: true,
    }),
    false,
  );
  assert.equal(
    shouldPrepareRelease({
      commitsAhead: 1,
      hasTreeDiff: false,
      hasChangesets: false,
    }),
    false,
  );
  assert.equal(
    shouldPrepareRelease({
      commitsAhead: 1,
      hasTreeDiff: true,
      hasChangesets: false,
    }),
    true,
  );
  assert.equal(
    shouldPrepareRelease({
      commitsAhead: 2,
      hasTreeDiff: false,
      hasChangesets: true,
    }),
    true,
  );
});
