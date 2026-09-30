import { appendFile, readFile, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import {
  APP,
  APP_MANIFEST,
  BRANCH_KINDS,
  CHANGELOG_PATH,
  PRODUCT_PATH_PREFIXES,
  assertVersion,
  backmergeBranch,
  buildVersionSection,
  bumpVersion,
  clearKind,
  clearPendingChangesets,
  computeNextVersion,
  configureBotIdentity,
  createGithubClient,
  deleteBranch,
  ensureSingleBranch,
  extractVersionSection,
  gitOutput,
  hotfixBranch,
  listCommitsBetween,
  parseVersionedBranch,
  pendingFrontendBumps,
  readChangelog,
  releaseBranch,
  releasePullBody,
  runGit,
  restoreEnvStablePaths,
  syncApiClient,
  upsertChangelog,
  upsertPull,
  writeChangelog,
  changesetTargets,
} from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

// --- prepare ---

function treesEqual(left, right) {
  return (
    gitOutput(["rev-parse", `${left}^{tree}`]) ===
    gitOutput(["rev-parse", `${right}^{tree}`])
  );
}

/** Commits on develop that are not already contained in main. */
export function developCommitsAhead(
  mainRef = "origin/main",
  developRef = "origin/develop",
) {
  const count = Number(
    gitOutput(["rev-list", "--count", `${mainRef}..${developRef}`]),
  );
  return Number.isFinite(count) ? count : 0;
}

/**
 * Open a release only when develop has new commits beyond main and there is
 * either a tree diff or pending changesets.
 */
export function shouldPrepareRelease({
  commitsAhead,
  hasTreeDiff,
  hasChangesets,
}) {
  if (commitsAhead < 1) return false;
  return hasTreeDiff || hasChangesets;
}

async function applyVersionDirect(plan, commits) {
  const manifest = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
  manifest.version = plan.version;
  await writeFile(
    APP_MANIFEST,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const changelog = await readChangelog();
  const section = buildVersionSection({
    version: plan.version,
    bump: plan.bump ?? "patch",
    summaryLines:
      plan.source === "changesets"
        ? [`Bump from pending frontend changesets (${plan.bump}).`]
        : undefined,
    commits,
  });
  await writeChangelog(upsertChangelog(changelog, section, plan.version));

  if (plan.source === "changesets") {
    await clearPendingChangesets();
  }
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

export async function prepareRelease() {
  process.chdir(root);
  configureBotIdentity();
  runGit(["fetch", "origin", "main", "develop", "--prune"]);

  const bumps = await (async () => {
    runGit(["checkout", "--force", "origin/develop"]);
    return pendingFrontendBumps();
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

  // Build release from latest main, then bring develop in.
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

  await applyVersionDirect(plan, commits);
  await commitRelease(plan);

  // Prod API client sync — separate commit after version bump.
  await syncApiClient("prod");
  // Destination (main) wins for env-stable trees after swagger sync.
  await restoreEnvStablePaths("origin/main");

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

  const { owner, github, repository } = createGithubClient();
  const pull = await upsertPull(github, owner, {
    title: `Release ${plan.version}`,
    head: branch,
    base: "main",
    repository,
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

// --- backmerge ---

function mainContainedInDevelop() {
  const result = runGit(
    ["merge-base", "--is-ancestor", "origin/main", "origin/develop"],
    { allowFailure: true },
  );
  return result.status === 0;
}

async function readVersionAt(ref) {
  const raw = gitOutput(["show", `${ref}:${APP_MANIFEST}`]);
  return assertVersion(JSON.parse(raw).version, APP);
}

export async function prepareBackmerge() {
  process.chdir(root);
  configureBotIdentity();
  runGit(["fetch", "origin", "main", "develop", "--prune"]);

  if (mainContainedInDevelop()) {
    console.log(
      "main is already an ancestor of develop; clearing backmerge branch.",
    );
    await clearKind(BRANCH_KINDS.backmerge, { base: "develop" });
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, "skipped=true\n", "utf8");
    }
    return;
  }

  const version = await readVersionAt("origin/main");
  const branch = backmergeBranch(version);

  // Recreate from latest main so the branch auto-rebases when main moves.
  runGit(["checkout", "--force", "-B", branch, "origin/main"]);

  // Dev API client sync — commit only when swagger differs.
  await syncApiClient("dev");
  // Destination (develop) wins for env-stable trees after swagger sync.
  await restoreEnvStablePaths("origin/develop");

  runGit(["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);

  await ensureSingleBranch(BRANCH_KINDS.backmerge, branch, {
    base: "develop",
    closeMessage: `Superseded by \`${branch}\` after main moved. Only one backmerge/X.X.X branch is kept open at a time.`,
  });

  const { owner, github, repository } = createGithubClient();
  const body = [
    "<!-- stablehouse-backmerge-summary:start -->",
    "## Backmerge",
    "",
    `- Version on main: \`${version}\``,
    `- Branch: \`${branch}\``,
    "",
    "Carries production releases and hotfixes from `main` back to `develop`.",
    "This branch is force-updated to the tip of `main` whenever main moves,",
    "and may include a `Sync API client from dev swagger` commit and a",
    "`Restore env-stable paths from develop` commit (see `ENV_STABLE_PATHS`).",
    "",
    "**Human merge only** — merge commit or fast-forward; **never squash**.",
    "Do not auto-merge.",
    "<!-- stablehouse-backmerge-summary:end -->",
  ].join("\n");

  const pull = await upsertPull(github, owner, {
    title: `Backmerge ${version} into develop`,
    head: branch,
    base: "develop",
    repository,
    body,
  });

  console.log(`Backmerge branch ${branch} ready: ${pull.html_url}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `skipped=false\nversion=${version}\nbranch=${branch}\nurl=${pull.html_url}\n`,
      "utf8",
    );
  }
}

// --- complete ---

export async function completeRelease() {
  const mergeSha = process.env.MERGE_SHA ?? "";
  const branch = process.env.HEAD_BRANCH ?? "";
  if (!/^[0-9a-f]{40}$/.test(mergeSha)) {
    throw new TypeError("MERGE_SHA must be a full commit SHA");
  }

  const { kind, version } = parseVersionedBranch(branch);
  if (kind !== "release" && kind !== "hotfix") {
    throw new TypeError(
      "Only release/* or hotfix/* merges complete a production version",
    );
  }

  const { github } = createGithubClient();
  const manifest = await github(
    `/contents/${APP_MANIFEST.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(mergeSha)}`,
  );
  const packageJson = JSON.parse(
    Buffer.from(manifest.content, "base64").toString("utf8"),
  );
  const packageVersion = assertVersion(packageJson.version, APP);
  if (packageVersion !== version) {
    throw new Error(
      `Branch version ${version} does not match ${APP} package ${packageVersion}`,
    );
  }

  const tag = `${APP}@${version}`;
  const encodedTag = encodeURIComponent(tag);
  const existingTag = await github(`/git/ref/tags/${encodedTag}`, {}, [404]);
  if (existingTag && existingTag.object.sha !== mergeSha) {
    throw new Error(`Tag ${tag} already points to a different commit`);
  }
  if (!existingTag) {
    await github("/git/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: mergeSha }),
    });
  }

  const changelogFile = await github(
    `/contents/${CHANGELOG_PATH.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(mergeSha)}`,
    {},
    [404],
  );
  const changelogText = changelogFile
    ? Buffer.from(changelogFile.content, "base64").toString("utf8")
    : "";
  const releaseBody =
    extractVersionSection(changelogText, version) ??
    `## ${version}\n\nReleased from \`${branch}\`.`;

  const existingRelease = await github(`/releases/tags/${encodedTag}`, {}, [
    404,
  ]);
  if (existingRelease) {
    await github(`/releases/${existingRelease.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tag,
        body: releaseBody,
      }),
    });
  } else {
    await github("/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: releaseBody,
        target_commitish: mergeSha,
      }),
    });
  }

  await deleteBranch(github, branch);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `kind=${kind}\nversion=${version}\ntag=${tag}\n`,
      "utf8",
    );
  }
  console.log(`Completed ${tag} from ${kind} at ${mergeSha}.`);
}

// --- hotfix ---

function parseHotfixArgs(argv) {
  let summary;
  let push = true;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-m" || token === "--message") {
      summary = argv[index + 1];
      if (!summary) throw new TypeError("Missing summary after -m");
      index += 1;
      continue;
    }
    if (token === "--no-push") {
      push = false;
      continue;
    }
    throw new TypeError(`Unknown argument: ${token}`);
  }
  return { summary, push };
}

async function resolveHotfixSummary(provided) {
  if (provided) return provided;
  if (!input.isTTY) {
    throw new TypeError('Pass -m "summary" when stdin is not a terminal');
  }
  const rl = createInterface({ input, output });
  try {
    return await rl.question("Hotfix summary: ");
  } finally {
    rl.close();
  }
}

function sanitizeSummary(summary) {
  const text = String(summary)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new TypeError("Hotfix summary must contain visible text");
  return text;
}

export async function runHotfix(argv = process.argv.slice(2)) {
  process.chdir(root);
  const { summary: provided, push } = parseHotfixArgs(argv);
  const summary = sanitizeSummary(await resolveHotfixSummary(provided));

  runGit(["fetch", "origin", "main", "--prune"]);
  const current = assertVersion(
    JSON.parse(gitOutput(["show", `origin/main:${APP_MANIFEST}`])).version,
    APP,
  );
  const version = bumpVersion(current, "patch");
  const branch = hotfixBranch(version);

  const dirty = gitOutput(["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      "Working tree is dirty. Commit or stash before yarn hotfix.",
    );
  }

  runGit(["checkout", "--force", "-B", branch, "origin/main"]);

  const manifest = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
  manifest.version = version;
  await writeFile(
    APP_MANIFEST,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const changelog = await readChangelog();
  const section = buildVersionSection({
    version,
    bump: "patch",
    summaryLines: [summary],
    commits: [],
  });
  await writeChangelog(upsertChangelog(changelog, section, version));

  runGit(["add", APP_MANIFEST, CHANGELOG_PATH]);
  runGit(["commit", "-m", `Hotfix ${APP} ${version}\n\n${summary}`]);

  console.log(`Created ${branch} (${current} → ${version}).`);
  console.log("Add your fix commits on this branch, then push if needed.");

  if (!push) return;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  runGit(["push", "--force", "-u", "origin", `HEAD:refs/heads/${branch}`]);

  if (!token) {
    console.log(
      "Pushed branch. Set GITHUB_TOKEN or GH_TOKEN (or use gh auth) to open the PR automatically.",
    );
    console.log(`Open a PR: ${branch} → main`);
    return;
  }

  process.env.GITHUB_TOKEN = token;
  if (!process.env.GITHUB_REPOSITORY) {
    const remote = gitOutput(["config", "--get", "remote.origin.url"]);
    const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) {
      throw new Error("Could not determine GITHUB_REPOSITORY from origin URL");
    }
    process.env.GITHUB_REPOSITORY = match[1];
  }

  await ensureSingleBranch(BRANCH_KINDS.hotfix, branch, {
    base: "main",
    closeMessage: `Superseded by \`${branch}\`. Only one hotfix/X.X.X branch is kept open at a time.`,
  });

  const { owner, github, repository } = createGithubClient();
  const pull = await upsertPull(github, owner, {
    title: `Hotfix ${version}`,
    head: branch,
    base: "main",
    repository,
    body: [
      "## Hotfix",
      "",
      `- Version: \`${version}\` (patch bump from \`${current}\`)`,
      `- Branch: \`${branch}\``,
      "",
      summary,
      "",
      "Created by `yarn hotfix`. Add fix commits on this branch before merging.",
      "After merge, CI opens `backmerge/<version>` into develop for human merge (never squash).",
    ].join("\n"),
  });

  console.log(`Hotfix PR: ${pull.html_url}`);
}

// --- status ---

function gitLinesAtRoot(args) {
  const result = spawnSync("git", args, { encoding: "utf8", cwd: root });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

async function pendingChangesets() {
  const entries = await readdir(`${root}/.changeset`, { withFileTypes: true });
  const pending = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.name === "README.md" ||
      !entry.name.endsWith(".md")
    ) {
      continue;
    }
    const path = `.changeset/${entry.name}`;
    if (
      changesetTargets(await readFile(`${root}/${path}`, "utf8")).has(APP)
    ) {
      pending.push(path);
    }
  }
  return pending.sort();
}

export async function releaseStatus() {
  process.chdir(root);
  const currentRef = process.env.GITHUB_REF_NAME ?? "HEAD";

  const packageJson = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
  const [latestTag] = gitLinesAtRoot([
    "tag",
    "--list",
    `${APP}@*`,
    "--sort=-v:refname",
  ]);
  const pathArgs = PRODUCT_PATH_PREFIXES.map((p) => p.replace(/\/$/, ""));
  const changedFiles = latestTag
    ? gitLinesAtRoot([
        "diff",
        "--name-only",
        `${latestTag}...HEAD`,
        "--",
        ...pathArgs,
      ])
    : gitLinesAtRoot([
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "--",
        ...pathArgs,
      ]);
  const pending = await pendingChangesets();
  const plan = await computeNextVersion({
    hasCommitDiffs: changedFiles.length > 0,
    requireChanges: true,
  });

  const compareUrl =
    latestTag && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/compare/${encodeURIComponent(latestTag)}...${encodeURIComponent(currentRef)}`
      : null;

  const summary = [
    "# Release status",
    "",
    `Status for \`${currentRef}\`.`,
    "",
    `- Version: \`${packageJson.version}\``,
    `- Latest tag: ${latestTag ? `\`${latestTag}\`` : "_none yet_"}`,
    `- Pending changesets: ${pending.length}`,
    ...pending.map((path) => `  - \`${path}\``),
    `- Next version if released from this tip: \`${plan.version}\` (${plan.source})`,
    `- Unreleased product files since tag: ${changedFiles.length}`,
    ...changedFiles.slice(0, 25).map((path) => `  - \`${path}\``),
    ...(changedFiles.length > 25
      ? [`  - _and ${changedFiles.length - 25} more_`]
      : []),
    ...(compareUrl ? [`- [Compare with latest tag](${compareUrl})`] : []),
    "",
    "Ephemeral branches (at most one each): `release/X.X.X`, `hotfix/X.X.X`, `backmerge/X.X.X`.",
    "",
  ].join("\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }
  console.log(summary);
}

// --- enforce-uniqueness ---

export async function enforceUniqueness(argv = process.argv.slice(2)) {
  const branch = process.env.HEAD_BRANCH ?? argv[0];
  const base = process.env.BASE_BRANCH ?? argv[1];
  if (!branch || !base) {
    throw new TypeError(
      "Usage: HEAD_BRANCH and BASE_BRANCH env vars, or release.mjs enforce-uniqueness <head> <base>",
    );
  }

  const { kind } = parseVersionedBranch(branch);
  await ensureSingleBranch(kind, branch, { base });
  console.log(`Ensured ${branch} is the only open ${kind}/* branch.`);
}

// --- CLI ---

const USAGE = `Usage:
  node scripts/release/release.mjs prepare
  node scripts/release/release.mjs backmerge
  node scripts/release/release.mjs complete
  node scripts/release/release.mjs hotfix ...
  node scripts/release/release.mjs status
  node scripts/release/release.mjs enforce-uniqueness`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "prepare") {
    await prepareRelease();
    return;
  }
  if (command === "backmerge") {
    await prepareBackmerge();
    return;
  }
  if (command === "complete") {
    await completeRelease();
    return;
  }
  if (command === "hotfix") {
    await runHotfix(rest);
    return;
  }
  if (command === "status") {
    await releaseStatus();
    return;
  }
  if (command === "enforce-uniqueness") {
    await enforceUniqueness(rest);
    return;
  }
  console.error(USAGE);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
