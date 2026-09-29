import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  APP,
  APP_PATH_PREFIXES,
  PRODUCT_PATH_PREFIXES,
  SHARED_PATH_PREFIXES,
  pathHasPrefix,
  changesetTargets,
  changesetReleases,
} from "./lib.mjs";

export { changesetTargets, changesetReleases };

const RELEASE_TYPES = new Set(["patch", "minor", "major"]);
const GIT_REF_PATTERN = /^[0-9A-Za-z_./-]+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Permanent branches — never write Contents API commits onto these heads. */
export const PERMANENT_HEAD_BRANCHES = Object.freeze(
  new Set(["main", "develop"]),
);

// --- add ---

export function parseAddArgs(argv) {
  const [bump, ...rest] = argv;
  if (!RELEASE_TYPES.has(bump)) {
    throw new TypeError(
      "Usage: changesets.mjs add <patch|minor|major> [-m summary]",
    );
  }

  let summary;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "-m" || token === "--message") {
      summary = rest[index + 1];
      if (!summary) throw new TypeError("Missing summary after -m");
      index += 1;
      continue;
    }
    if (token === APP || token === "web") continue;
    if (token.startsWith("-")) {
      throw new TypeError(`Unknown flag: ${token}`);
    }
    throw new TypeError(
      `Unknown package ${token}; this repository only versions ${APP}`,
    );
  }

  return { bump, summary };
}

export function changesetMarkdown(bump, summary) {
  const text = String(summary)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new TypeError("Changeset summary must contain visible text");
  return `---
"${APP}": ${bump}
---

${text}
`;
}

function gitPaths(args) {
  const result = spawnSync("git", args, { encoding: "utf8", cwd: root });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").filter(Boolean);
}

function changedPathsForAdd() {
  return [
    ...new Set([
      ...gitPaths(["diff", "--name-only", "develop...HEAD"]),
      ...gitPaths(["diff", "--name-only", "develop"]),
      ...gitPaths(["diff", "--name-only", "--cached"]),
      ...gitPaths(["diff", "--name-only"]),
    ]),
  ];
}

async function resolveSummary(provided) {
  if (provided) return provided;
  if (!input.isTTY) {
    throw new TypeError('Pass -m "summary" when stdin is not a terminal');
  }
  const rl = createInterface({ input, output });
  try {
    return await rl.question("Summary: ");
  } finally {
    rl.close();
  }
}

export async function addChangeset(argv = process.argv.slice(2)) {
  process.chdir(root);
  const parsed = parseAddArgs(argv);
  const paths = changedPathsForAdd();

  if (!needsWebChangeset(paths) && paths.length > 0) {
    console.log(
      "No versioned product code in the diff. Writing a web changeset anyway since you invoked yarn changeset.",
    );
  }

  const summary = await resolveSummary(parsed.summary);
  const name = `${parsed.bump}-web-${randomBytes(4).toString("hex")}.md`;
  const path = `.changeset/${name}`;
  await writeFile(path, changesetMarkdown(parsed.bump, summary), "utf8");
  console.log(`Wrote ${parsed.bump} changeset:\n- ${path}`);
}

// --- check ---

export function needsWebChangeset(paths) {
  return paths.some((path) => pathHasPrefix(path, PRODUCT_PATH_PREFIXES));
}

/** @deprecated Alias kept for parity with the MISC frontend naming. */
export const needsFrontendChangeset = needsWebChangeset;

export function isSharedOnlyChange(paths) {
  const touchesShared = paths.some((path) =>
    pathHasPrefix(path, SHARED_PATH_PREFIXES),
  );
  const touchesApp = paths.some((path) =>
    pathHasPrefix(path, APP_PATH_PREFIXES),
  );
  return touchesShared && !touchesApp;
}

export function validationErrors(paths, entries, pullNumber) {
  const errors = [];
  const contents = entries.map((entry) => entry.contents);
  const supplied = new Set(
    contents.flatMap((entry) => [...changesetTargets(entry)]),
  );

  if (needsWebChangeset(paths) && !supplied.has(APP)) {
    errors.push(`Changed versioned code is missing a ${APP} changeset`);
  }

  for (const entry of entries) {
    const releases = changesetReleases(entry.contents);
    for (const name of releases.keys()) {
      if (name !== APP) {
        errors.push(
          `${entry.path} targets unknown package ${name}; only "${APP}" is versioned`,
        );
      }
    }
  }

  // Optional CI may add shared-pr-N.md for shared-only PRs. When present it must
  // target web: patch; an authored web changeset alone also passes.
  if (
    isSharedOnlyChange(paths) &&
    Number.isSafeInteger(pullNumber) &&
    pullNumber >= 1
  ) {
    const generatedPath = `.changeset/shared-pr-${pullNumber}.md`;
    const generated = entries.find((entry) => entry.path === generatedPath);
    if (
      generated &&
      changesetReleases(generated.contents).get(APP) !== "patch"
    ) {
      errors.push(
        `${generatedPath} must contain a generated ${APP}: patch release`,
      );
    }
  }

  return errors;
}

function assertGitRef(ref, label) {
  if (!GIT_REF_PATTERN.test(ref)) {
    throw new TypeError(`${label} contains unsupported characters`);
  }
  return ref;
}

function changedPaths(base, head) {
  assertGitRef(base, "base ref");
  assertGitRef(head, "head ref");

  const result = spawnSync(
    "git",
    ["diff", "--name-only", `${base}...${head}`],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || "Unable to calculate changed files",
    );
  }
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * Read changeset markdown from the given git ref (typically the PR head SHA).
 * Never reads from the working tree so CI can execute trusted base scripts
 * while still validating untrusted head content as data only.
 */
export function readBlobAtRef(ref, path) {
  assertGitRef(ref, "ref");
  if (
    !path ||
    path.includes("\0") ||
    path.includes("..") ||
    path.startsWith("/")
  ) {
    throw new TypeError(`Unsafe path for git show: ${path}`);
  }
  const result = spawnSync("git", ["show", `${ref}:${path}`], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "").trim() ||
        `Unable to read ${path} at ${ref}`,
    );
  }
  return result.stdout;
}

export function changesetContentsFromRef(paths, head) {
  const changedChangesets = paths.filter(
    (path) =>
      path.startsWith(".changeset/") &&
      path.endsWith(".md") &&
      path !== ".changeset/README.md",
  );
  return changedChangesets.map((path) => ({
    path,
    contents: readBlobAtRef(head, path),
  }));
}

export async function checkChangeset(argv = process.argv.slice(2)) {
  const [base, head = "HEAD"] = argv;
  if (!base) {
    console.log("Usage: changesets.mjs check <base-ref> [head-ref]");
    return;
  }

  const paths = changedPaths(base, head);
  const errors = validationErrors(
    paths,
    changesetContentsFromRef(paths, head),
    Number(process.env.PR_NUMBER),
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log("Changeset scope matches changed versioned code.");
}

// --- shared ---

export function generatedFileName(pullNumber) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("Pull request number must be a positive integer");
  }
  return `.changeset/shared-pr-${pullNumber}.md`;
}

/**
 * Shared-changeset automation may only commit onto ephemeral PR heads.
 * Refuses main, develop, and anything outside a simple branch name pattern.
 */
export function assertWritableHeadBranch(branch) {
  const name = String(branch ?? "").replace(/^refs\/heads\//, "");
  if (
    !BRANCH_PATTERN.test(name) ||
    name.startsWith("/") ||
    name.includes("..")
  ) {
    throw new TypeError("Pull request branch contains unsupported characters");
  }
  if (PERMANENT_HEAD_BRANCHES.has(name)) {
    throw new Error(
      `Refusing to write shared changeset onto permanent branch \`${name}\``,
    );
  }
  return name;
}

export function generatedChangeset(title) {
  const summary = String(title)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!summary)
    throw new TypeError("Pull request title must contain visible text");

  return `---
"${APP}": patch
---

Shared package change: ${summary}
`;
}

function isSharedOnly(files) {
  const paths = files.map((file) => file.filename);
  const touchesShared = paths.some((path) =>
    pathHasPrefix(path, SHARED_PATH_PREFIXES),
  );
  const touchesApp = paths.some((path) =>
    pathHasPrefix(path, APP_PATH_PREFIXES),
  );
  return touchesShared && !touchesApp;
}

function apiClient(repository, token) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
  }
  if (!token) throw new TypeError("GITHUB_TOKEN is required");
  const base = `https://api.github.com/repos/${repository}`;

  return async function github(path, options = {}, allowNotFound = false) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
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

async function pullFiles(github, pullNumber) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) return files;
  }
}

async function currentFile(github, path, branch) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return github(
    `/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    {},
    true,
  );
}

async function upsert(github, path, branch, content, pullNumber) {
  const existing = await currentFile(github, path, branch);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const encoded = Buffer.from(content, "utf8").toString("base64");
  if (existing?.content?.replace(/\n/g, "") === encoded) return;

  await github(`/contents/${encodedPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Add shared web changeset for PR #${pullNumber}`,
      content: encoded,
      branch,
      ...(existing ? { sha: existing.sha } : {}),
    }),
  });
}

async function remove(github, path, branch, pullNumber) {
  const existing = await currentFile(github, path, branch);
  if (!existing) return;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  await github(`/contents/${encodedPath}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Remove stale shared changeset for PR #${pullNumber}`,
      sha: existing.sha,
      branch,
    }),
  });
}

export async function sharedChangesets() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const pullNumber = Number(process.env.PR_NUMBER);
  const title = process.env.PR_TITLE ?? "";
  const github = apiClient(repository, process.env.GITHUB_TOKEN);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("PR_NUMBER must be a positive integer");
  }

  const pull = await github(`/pulls/${pullNumber}`);
  if (pull.head.repo.full_name !== repository) {
    console.log(
      "Skipping shared changeset automation for cross-repository (fork) PR.",
    );
    return;
  }
  const branch = assertWritableHeadBranch(pull.head.ref);

  const files = await pullFiles(github, pullNumber);
  const path = generatedFileName(pullNumber);

  if (isSharedOnly(files)) {
    await upsert(github, path, branch, generatedChangeset(title), pullNumber);
    console.log("Generated web patch changeset for shared-only changes.");
  } else {
    await remove(github, path, branch, pullNumber);
    console.log("Not shared-only; generated shared changeset is absent.");
  }
}

// --- CLI ---

const USAGE = `Usage:
  node scripts/release/changesets.mjs add <patch|minor|major> [-m summary]
  node scripts/release/changesets.mjs check <base> [head]
  node scripts/release/changesets.mjs shared`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "add") {
    await addChangeset(rest);
    return;
  }
  if (command === "check") {
    await checkChangeset(rest);
    return;
  }
  if (command === "shared") {
    await sharedChangesets();
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
