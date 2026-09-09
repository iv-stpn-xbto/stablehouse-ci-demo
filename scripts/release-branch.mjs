import { appendFile, readFile, readdir } from "node:fs/promises";
import { assertApp, assertVersion, releaseBranch } from "./release-policy.mjs";
import { changesetTargets } from "./check-changeset-scope.mjs";

const STOCK_BRANCH = "changeset-release/main";
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "";
const TOKEN = process.env.GITHUB_TOKEN;

function apiClient() {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPOSITORY)) {
    throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
  }
  if (!TOKEN) throw new TypeError("GITHUB_TOKEN is required");
  const base = `https://api.github.com/repos/${REPOSITORY}`;

  return async function github(path, options = {}, allowNotFound = false) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

async function pending(app) {
  assertApp(app);
  const entries = await readdir(".changeset", { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "README.md" || !entry.name.endsWith(".md")) continue;
    if (changesetTargets(await readFile(`.changeset/${entry.name}`, "utf8")).has(app)) {
      return true;
    }
  }
  return false;
}

async function branchExists(github, branch) {
  return Boolean(
    await github(`/branches/${encodeURIComponent(branch)}`, {}, true),
  );
}

async function renameBranch(github, from, to) {
  await github(`/branches/${encodeURIComponent(from)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: to }),
  });
}

async function normalize(app) {
  assertApp(app);
  const github = apiClient();
  const pulls = await github("/pulls?state=open&base=main&per_page=100");
  const stockPull = pulls.find((pull) => pull.head.ref === STOCK_BRANCH);
  if (stockPull) {
    if (stockPull.title !== `Version ${app}`) {
      throw new Error(`${STOCK_BRANCH} belongs to another app release`);
    }
    console.log(`${app} release is already using ${STOCK_BRANCH}.`);
    return;
  }
  const releasePull = pulls.find(
    (pull) =>
      pull.title === `Version ${app}` &&
      pull.head.ref.startsWith(`release/${app}/`),
  );
  if (!releasePull) {
    if (await branchExists(github, STOCK_BRANCH)) {
      throw new Error(`${STOCK_BRANCH} exists without an open app release PR`);
    }
    console.log(`No existing ${app} release branch to normalize.`);
    return;
  }
  if (await branchExists(github, STOCK_BRANCH)) {
    throw new Error(`${STOCK_BRANCH} is unexpectedly in use`);
  }
  await renameBranch(github, releasePull.head.ref, STOCK_BRANCH);
  console.log(`Normalized ${releasePull.head.ref} to ${STOCK_BRANCH}.`);
}

async function finalize(app, pullNumberText) {
  assertApp(app);
  if (!/^\d+$/.test(pullNumberText ?? "")) {
    throw new TypeError("A numeric pull request number is required");
  }
  const github = apiClient();
  const pullNumber = Number(pullNumberText);
  const files = await github(`/pulls/${pullNumber}/files?per_page=100`);
  const expectedManifest = `apps/${app}/package.json`;
  if (!files.some((file) => file.filename === expectedManifest)) {
    throw new Error(`${expectedManifest} was not changed by the version PR`);
  }
  const version = assertVersion(
    JSON.parse(await readFile(expectedManifest, "utf8")).version,
    app,
  );
  const targetBranch = releaseBranch(app, version);
  if (await branchExists(github, targetBranch)) {
    throw new Error(`${targetBranch} already exists`);
  }
  await renameBranch(github, STOCK_BRANCH, targetBranch);

  const pull = await github(`/pulls/${pullNumber}`);
  const summary = [
    "<!-- stablehouse-release-summary:start -->",
    "## App release",
    "",
    `- App: \`${app}\``,
    `- Version: \`${version}\``,
    `- Branch: \`${targetBranch}\``,
    "<!-- stablehouse-release-summary:end -->",
  ].join("\n");
  const body = (pull.body ?? "").replace(
    /\n*<!-- stablehouse-release-summary:start -->[\s\S]*?<!-- stablehouse-release-summary:end -->/g,
    "",
  );
  await github(`/pulls/${pullNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: `${body.trim()}\n\n${summary}` }),
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `branch=${targetBranch}\n`, "utf8");
  }
  console.log(`Renamed ${STOCK_BRANCH} to ${targetBranch}.`);
}

const [command, app, argument] = process.argv.slice(2);
if (command === "pending") {
  const hasPending = await pending(app);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `pending=${hasPending}\n`, "utf8");
  }
  console.log(hasPending ? `${app} has pending changesets.` : `${app} has no pending changesets.`);
} else if (command === "normalize") {
  await normalize(app);
} else if (command === "finalize") {
  await finalize(app, argument);
} else {
  throw new TypeError(
    "Usage: release-branch.mjs <pending|normalize|finalize> <app> [pull-number]",
  );
}
