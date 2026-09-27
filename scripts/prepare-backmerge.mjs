import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clearKind, ensureSingleBranch } from "./ensure-single-branch.mjs";
import { configureBotIdentity, gitOutput, runGit } from "./git.mjs";
import { createGithubClient, upsertPull } from "./github.mjs";
import {
  APP_MANIFEST,
  BRANCH_KINDS,
  assertVersion,
  backmergeBranch,
} from "./release-policy.mjs";

function mainContainedInDevelop() {
  const result = runGit(
    ["merge-base", "--is-ancestor", "origin/main", "origin/develop"],
    { allowFailure: true },
  );
  return result.status === 0;
}

async function readVersionAt(ref) {
  const raw = gitOutput(["show", `${ref}:${APP_MANIFEST}`]);
  return assertVersion(JSON.parse(raw).version, "web");
}

async function prepareBackmerge() {
  configureBotIdentity();
  runGit(["fetch", "origin", "main", "develop", "--prune"]);

  if (mainContainedInDevelop()) {
    console.log("main is already an ancestor of develop; clearing backmerge branch.");
    await clearKind(BRANCH_KINDS.backmerge, { base: "develop" });
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, "skipped=true\n", "utf8");
    }
    return;
  }

  const version = await readVersionAt("origin/main");
  const branch = backmergeBranch(version);

  // Recreate from latest main so the branch auto-rebases when main moves
  // (for example after a hotfix).
  runGit(["checkout", "--force", "-B", branch, "origin/main"]);
  runGit(["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);

  await ensureSingleBranch(BRANCH_KINDS.backmerge, branch, {
    base: "develop",
    closeMessage: `Superseded by \`${branch}\` after main moved. Only one backmerge/X.X.X branch is kept open at a time.`,
  });

  const { owner, github } = createGithubClient();
  const body = [
    "<!-- stablehouse-backmerge-summary:start -->",
    "## Backmerge",
    "",
    `- Version on main: \`${version}\``,
    `- Branch: \`${branch}\``,
    "",
    "Carries production releases and hotfixes from `main` back to `develop`.",
    "This branch is force-updated to the tip of `main` whenever main's version changes.",
    "<!-- stablehouse-backmerge-summary:end -->",
  ].join("\n");

  const pull = await upsertPull(github, owner, {
    title: `Backmerge ${version} into develop`,
    head: branch,
    base: "develop",
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareBackmerge().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
