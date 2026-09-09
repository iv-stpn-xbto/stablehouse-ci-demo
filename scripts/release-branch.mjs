import { readFile } from "node:fs/promises";
import { assertVersion, selectTrainVersion } from "./release-policy.mjs";

const STOCK_BRANCH = "changeset-release/main";
const RELEASE_BRANCH = /^release\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const REPOSITORY = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;

if (!REPOSITORY || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPOSITORY)) {
  throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
}
if (!TOKEN) throw new TypeError("GITHUB_TOKEN is required");

const apiBase = `https://api.github.com/repos/${REPOSITORY}`;

async function github(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function branchExists(branch) {
  const response = await fetch(
    `${apiBase}/branches/${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Unable to inspect branch ${branch}: ${response.status}`);
  return true;
}

async function deleteBranch(branch) {
  await github(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" });
}

async function renameBranch(from, to) {
  await github(`/branches/${encodeURIComponent(from)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: to }),
  });
}

async function openVersionPullRequests() {
  return github("/pulls?state=open&base=main&per_page=100");
}

async function normalize() {
  const pulls = await openVersionPullRequests();
  const releasePull = pulls.find(
    (pull) => pull.title.startsWith("Version Packages") && RELEASE_BRANCH.test(pull.head.ref),
  );
  if (!releasePull) {
    console.log("No existing named release branch to normalize.");
    return;
  }

  if (await branchExists(STOCK_BRANCH)) await deleteBranch(STOCK_BRANCH);
  await renameBranch(releasePull.head.ref, STOCK_BRANCH);
  console.log(`Normalized ${releasePull.head.ref} to ${STOCK_BRANCH}.`);
}

async function packageVersion(path) {
  const packageJson = JSON.parse(await readFile(path, "utf8"));
  return assertVersion(packageJson.version, path);
}

async function finalize(pullNumberText) {
  if (!/^\d+$/.test(pullNumberText ?? "")) {
    throw new TypeError("A numeric pull request number is required");
  }

  const pullNumber = Number(pullNumberText);
  const files = await github(`/pulls/${pullNumber}/files?per_page=100`);
  const changed = new Set(files.map((file) => file.filename));
  const webVersion = await packageVersion("apps/web/package.json");
  const backofficeVersion = await packageVersion("apps/backoffice/package.json");
  const trainVersion = selectTrainVersion(changed, {
    web: webVersion,
    backoffice: backofficeVersion,
  });

  const targetBranch = `release/${trainVersion}`;
  if (await branchExists(targetBranch)) await deleteBranch(targetBranch);
  await renameBranch(STOCK_BRANCH, targetBranch);

  const pull = await github(`/pulls/${pullNumber}`);
  const releaseSummary = [
    "<!-- stablehouse-release-summary:start -->",
    "## Release train",
    "",
    `- Web: \`${webVersion}\``,
    `- Backoffice: \`${backofficeVersion}\``,
    `- Branch: \`${targetBranch}\``,
    "<!-- stablehouse-release-summary:end -->",
  ].join("\n");
  const bodyWithoutOldSummary = (pull.body ?? "").replace(
    /\n*<!-- stablehouse-release-summary:start -->[\s\S]*?<!-- stablehouse-release-summary:end -->/g,
    "",
  );
  await github(`/pulls/${pullNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: `${bodyWithoutOldSummary.trim()}\n\n${releaseSummary}` }),
  });

  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `branch=${targetBranch}\n`, "utf8");
  }
  console.log(`Renamed ${STOCK_BRANCH} to ${targetBranch}.`);
}

const [command, argument] = process.argv.slice(2);
if (command === "normalize") await normalize();
else if (command === "finalize") await finalize(argument);
else throw new TypeError("Usage: release-branch.mjs <normalize|finalize> [pull-number]");
