import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  APP,
  APP_MANIFEST,
  assertVersion,
  bumpVersion,
  highestBump,
} from "./release-policy.mjs";
import { changesetReleases } from "./check-changeset-scope.mjs";

export async function pendingWebBumps(changesetDir = ".changeset") {
  const entries = await readdir(changesetDir, { withFileTypes: true });
  const bumps = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "README.md" || !entry.name.endsWith(".md")) {
      continue;
    }
    const contents = await readFile(`${changesetDir}/${entry.name}`, "utf8");
    const release = changesetReleases(contents).get(APP);
    if (release) bumps.add(release);
  }
  return bumps;
}

export async function readWebVersion(manifestPath = APP_MANIFEST) {
  const packageJson = JSON.parse(await readFile(manifestPath, "utf8"));
  return assertVersion(packageJson.version, APP);
}

/**
 * Next release version for the current working tree.
 * Uses the highest pending web changeset bump, or patch when there are
 * commit diffs but no changesets (chores / CI-driven releases).
 */
export async function computeNextVersion({
  requireChanges = false,
  hasCommitDiffs = false,
} = {}) {
  const current = await readWebVersion();
  const bumps = await pendingWebBumps();
  const bump = highestBump(bumps);

  if (bump) {
    return {
      current,
      version: bumpVersion(current, bump),
      bump,
      source: "changesets",
    };
  }

  if (hasCommitDiffs || !requireChanges) {
    return {
      current,
      version: bumpVersion(current, "patch"),
      bump: "patch",
      source: "patch-fallback",
    };
  }

  return {
    current,
    version: current,
    bump: null,
    source: "none",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await computeNextVersion({ hasCommitDiffs: true });
  console.log(JSON.stringify(result, null, 2));
}
