import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPermanentBaseBranch,
  atLeastBump,
  bumpVersion,
  computeNextVersion,
  highestBump,
  isVersionedBranch,
  parseVersionedBranch,
  pendingFrontendBumps,
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

test("pendingFrontendBumps collects intended release types", async () => {
  const root = await mkdtemp(join(tmpdir(), "sh-bumps-"));
  const dir = join(root, ".changeset");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "a.md"),
    `---
"frontend": patch
---

A
`,
    "utf8",
  );
  await writeFile(
    join(dir, "b.md"),
    `---
"frontend": minor
---

B
`,
    "utf8",
  );
  await writeFile(join(dir, "README.md"), "ignore", "utf8");

  const bumps = await pendingFrontendBumps(dir);
  assert.deepEqual([...bumps].sort(), ["minor", "patch"]);
  assert.equal(highestBump(bumps), "minor");
  assert.equal(bumpVersion("4.1.5", highestBump(bumps)), "4.2.0");
  await rm(root, { recursive: true, force: true });
});

test("isVersionedBranch rejects legacy per-app release names", () => {
  assert.equal(isVersionedBranch("release/4.1.6"), true);
  assert.equal(isVersionedBranch("release/frontend/4.1.6"), false);
  assert.equal(isVersionedBranch("hotfix/4.1.6", "hotfix"), true);
  assert.equal(isVersionedBranch("hotfix/4.1.6", "release"), false);
  assert.throws(() => parseVersionedBranch("release/frontend/4.0.0"));
});

test("versioned branches use release|hotfix|backmerge/X.X.X", () => {
  assert.equal(releaseBranch("4.2.0"), "release/4.2.0");
  assert.equal(hotfixBranch("4.1.6"), "hotfix/4.1.6");
  assert.equal(backmergeBranch("4.1.6"), "backmerge/4.1.6");
  assert.deepEqual(parseVersionedBranch("release/4.2.0"), {
    kind: "release",
    version: "4.2.0",
  });
});

test("semver helpers pick the highest bump", () => {
  assert.equal(bumpVersion("4.1.5", "patch"), "4.1.6");
  assert.equal(bumpVersion("4.1.5", "minor"), "4.2.0");
  assert.equal(bumpVersion("4.1.5", "major"), "5.0.0");
  assert.equal(highestBump(["patch", "minor"]), "minor");
  assert.equal(highestBump(new Set(["major", "patch"])), "major");
});

test("release bumps floor at minor; hotfixes stay patch via atLeastBump", () => {
  assert.equal(atLeastBump("patch", "minor"), "minor");
  assert.equal(atLeastBump("minor", "minor"), "minor");
  assert.equal(atLeastBump("major", "minor"), "major");
  assert.equal(atLeastBump(null, "minor"), "minor");
  assert.equal(atLeastBump("patch", "patch"), "patch");
});

test("computeNextVersion floors patch changesets and chore fallback to minor", async () => {
  const root = await mkdtemp(join(tmpdir(), "sh-next-"));
  const dir = join(root, ".changeset");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "frontend", version: "1.2.2" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(dir, "a.md"),
    `---
"frontend": patch
---

chore
`,
    "utf8",
  );

  const prev = process.cwd();
  process.chdir(root);
  try {
    const fromPatch = await computeNextVersion({ hasCommitDiffs: true });
    assert.equal(fromPatch.bump, "minor");
    assert.equal(fromPatch.version, "1.3.0");
    assert.equal(fromPatch.source, "changesets");

    await rm(join(dir, "a.md"));
    const fallback = await computeNextVersion({ hasCommitDiffs: true });
    assert.equal(fallback.bump, "minor");
    assert.equal(fallback.version, "1.3.0");
    assert.equal(fallback.source, "minor-fallback");
  } finally {
    process.chdir(prev);
    await rm(root, { recursive: true, force: true });
  }
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
