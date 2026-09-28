import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingWebBumps } from "../scripts/compute-version.mjs";
import { shouldPrepareRelease } from "../scripts/prepare-release.mjs";
import {
  bumpVersion,
  highestBump,
  isVersionedBranch,
  parseVersionedBranch,
} from "../scripts/release-policy.mjs";

test("pendingWebBumps collects the highest intended release types", async () => {
  const root = await mkdtemp(join(tmpdir(), "stablehouse-bumps-"));
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
  assert.equal(bumpVersion("1.0.0", highestBump(bumps)), "1.1.0");
  await rm(root, { recursive: true, force: true });
});

test("isVersionedBranch rejects legacy per-app release names", () => {
  assert.equal(isVersionedBranch("release/1.2.3"), true);
  assert.equal(isVersionedBranch("release/web/1.2.3"), false);
  assert.equal(isVersionedBranch("hotfix/1.2.4", "hotfix"), true);
  assert.equal(isVersionedBranch("hotfix/1.2.4", "release"), false);
  assert.throws(() => parseVersionedBranch("release/web/1.0.0"));
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
