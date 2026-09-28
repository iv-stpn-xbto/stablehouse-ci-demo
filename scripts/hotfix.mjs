import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { ensureSingleBranch } from "./ensure-single-branch.mjs";
import { gitOutput, runGit } from "./git.mjs";
import { createGithubClient, upsertPull } from "./github.mjs";
import {
  APP,
  APP_MANIFEST,
  BRANCH_KINDS,
  assertVersion,
  bumpVersion,
  hotfixBranch,
} from "./release-policy.mjs";
import {
  buildVersionSection,
  readChangelog,
  upsertChangelog,
  writeChangelog,
} from "./release-notes.mjs";

function parseArgs(argv) {
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

async function resolveSummary(provided) {
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

async function main() {
  const { summary: provided, push } = parseArgs(process.argv.slice(2));
  const summary = sanitizeSummary(await resolveSummary(provided));

  runGit(["fetch", "origin", "main", "--prune"]);
  const current = assertVersion(
    JSON.parse(gitOutput(["show", `origin/main:${APP_MANIFEST}`])).version,
    APP,
  );
  const version = bumpVersion(current, "patch");
  const branch = hotfixBranch(version);

  const dirty = gitOutput(["status", "--porcelain"]);
  if (dirty) {
    throw new Error("Working tree is dirty. Commit or stash before yarn hotfix.");
  }

  runGit(["checkout", "--force", "-B", branch, "origin/main"]);

  const manifest = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
  manifest.version = version;
  await writeFile(APP_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const changelog = await readChangelog();
  const section = buildVersionSection({
    version,
    bump: "patch",
    summaryLines: [summary],
    commits: [],
  });
  await writeChangelog(upsertChangelog(changelog, section, version));

  runGit(["add", APP_MANIFEST, `apps/${APP}/CHANGELOG.md`]);
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

  const { owner, github } = createGithubClient();
  const pull = await upsertPull(github, owner, {
    title: `Hotfix ${version}`,
    head: branch,
    base: "main",
    body: [
      "## Hotfix",
      "",
      `- Version: \`${version}\` (patch bump from \`${current}\`)`,
      `- Branch: \`${branch}\``,
      "",
      summary,
      "",
      "Created by `yarn hotfix`. Add fix commits on this branch before merging.",
    ].join("\n"),
  });

  console.log(`Hotfix PR: ${pull.html_url}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
