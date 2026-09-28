import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { computeNextVersion, pendingWebBumps } from "./compute-version.mjs";
import { clearKind, ensureSingleBranch } from "./ensure-single-branch.mjs";
import { configureBotIdentity, gitOutput, runGit } from "./git.mjs";
import { createGithubClient, upsertPull } from "./github.mjs";
import {
  APP,
  APP_MANIFEST,
  BRANCH_KINDS,
  releaseBranch,
} from "./release-policy.mjs";
import {
  attachCommitsToChangelog,
  buildVersionSection,
  extractVersionSection,
  listCommitsBetween,
  readChangelog,
  releasePullBody,
  upsertChangelog,
  writeChangelog,
} from "./release-notes.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function treesEqual(left, right) {
  return (
    gitOutput(["rev-parse", `${left}^{tree}`]) ===
    gitOutput(["rev-parse", `${right}^{tree}`])
  );
}

/** Commits on develop that are not already contained in main. */
export function developCommitsAhead(mainRef = "origin/main", developRef = "origin/develop") {
  const count = Number(
    gitOutput(["rev-list", "--count", `${mainRef}..${developRef}`]),
  );
  return Number.isFinite(count) ? count : 0;
}

/**
 * Open a release only when develop has new commits beyond main and there is
 * either a tree diff or pending changesets. This avoids reopening a release
 * after main moves (or after a backmerge) with no new develop work.
 */
export function shouldPrepareRelease({ commitsAhead, hasTreeDiff, hasChangesets }) {
  if (commitsAhead < 1) return false;
  return hasTreeDiff || hasChangesets;
}

async function applyVersion(plan, commits) {
  if (plan.source === "changesets") {
    const cli = resolve(root, "node_modules/@changesets/cli/bin.js");
    const result = spawnSync(process.execPath, [cli, "version"], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error("changeset version failed");
    }
    const changelog = await readChangelog();
    await writeChangelog(attachCommitsToChangelog(changelog, plan.version, commits));
    return;
  }

  const manifest = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
  manifest.version = plan.version;
  await writeFile(APP_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const changelog = await readChangelog();
  const section = buildVersionSection({
    version: plan.version,
    bump: plan.bump ?? "patch",
    commits,
  });
  await writeChangelog(upsertChangelog(changelog, section, plan.version));
}

async function commitRelease(plan) {
  runGit(["add", "-A"]);
  const staged = gitOutput(["diff", "--cached", "--name-only"], {
    allowFailure: true,
  });
  if (!staged) {
    console.log("No version commit required.");
    return;
  }
  runGit(["commit", "-m", `Version ${APP} ${plan.version}`]);
}

async function prepareRelease() {
  configureBotIdentity();
  runGit(["fetch", "origin", "main", "develop", "--prune"]);

  const bumps = await (async () => {
    runGit(["checkout", "--force", "origin/develop"]);
    return pendingWebBumps();
  })();

  const commitsAhead = developCommitsAhead();
  const hasTreeDiff = !treesEqual("origin/main", "origin/develop");
  if (
    !shouldPrepareRelease({
      commitsAhead,
      hasTreeDiff,
      hasChangesets: bumps.size > 0,
    })
  ) {
    console.log(
      commitsAhead < 1
        ? "develop has no commits ahead of main; clearing release branch."
        : "develop commits ahead of main introduce no tree/changeset changes; clearing release branch.",
    );
    await clearKind(BRANCH_KINDS.release, { base: "main" });
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, "skipped=true\n", "utf8");
    }
    return;
  }

  const commits = listCommitsBetween("origin/main", "origin/develop");

  // Build release from latest main, then bring develop in (rebase-equivalent).
  runGit(["checkout", "--force", "-B", "release-work", "origin/main"]);
  const merge = runGit(["merge", "--no-edit", "origin/develop"], {
    allowFailure: true,
  });
  if (merge.status !== 0) {
    runGit(["merge", "--abort"], { allowFailure: true });
    throw new Error(
      "Could not merge develop into main for the release branch. Resolve conflicts in a develop→main integration branch first.",
    );
  }

  const plan = await computeNextVersion({ hasCommitDiffs: true });

  await applyVersion(plan, commits);
  await commitRelease(plan);

  const branch = releaseBranch(plan.version);
  runGit(["branch", "-f", branch, "HEAD"]);
  runGit(["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);

  await ensureSingleBranch(BRANCH_KINDS.release, branch, { base: "main" });

  const changelogSection =
    extractVersionSection(await readChangelog(), plan.version) ??
    buildVersionSection({
      version: plan.version,
      bump: plan.bump ?? "patch",
      commits,
    });

  const { owner, github } = createGithubClient();
  const pull = await upsertPull(github, owner, {
    title: `Release ${plan.version}`,
    head: branch,
    base: "main",
    body: releasePullBody({
      version: plan.version,
      branch,
      source: plan.source,
      changelogSection,
    }),
  });

  console.log(`Release branch ${branch} ready: ${pull.html_url}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `skipped=false\nversion=${plan.version}\nbranch=${branch}\nurl=${pull.html_url}\n`,
      "utf8",
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
