import { spawnSync } from "node:child_process";
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";

// --- git ---
export function runGit(args, { allowFailure = false, input } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args[0]} failed`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
  };
}

export function gitLines(args, options) {
  const { stdout, status } = runGit(args, { allowFailure: true, ...options });
  if (status !== 0) return [];
  return stdout.split("\n").filter(Boolean);
}

export function gitOutput(args, options) {
  return runGit(args, options).stdout.trim();
}

export function configureBotIdentity() {
  runGit(["config", "user.name", "github-actions[bot]"]);
  runGit([
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
}

// --- github ---
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createGithubClient({
  repository = process.env.GITHUB_REPOSITORY ?? "",
  token = process.env.GITHUB_TOKEN,
} = {}) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
  }
  if (!token) throw new TypeError("GITHUB_TOKEN is required");

  const [owner] = repository.split("/");
  const base = `https://api.github.com/repos/${repository}`;

  async function github(path, options = {}, allowedStatuses = []) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const detail = await response.text();
      throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (response.status === 204 || allowedStatuses.includes(response.status)) {
      return null;
    }
    return response.json();
  }

  return { owner, repository, github };
}

/** Same-repo heads only — never close/update fork (cross-repository) PRs. */
export function isSameRepositoryPull(pull, repository) {
  if (!pull?.head) return false;
  if (pull.head.repo == null) return true;
  return pull.head.repo.full_name === repository;
}

export async function listOpenPulls(
  github,
  { base, headPrefix, repository } = {},
) {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({
      state: "open",
      per_page: "100",
      page: String(page),
    });
    if (base) query.set("base", base);
    const batch = await github(`/pulls?${query}`);
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  let filtered = pulls;
  if (repository) {
    filtered = filtered.filter((pull) =>
      isSameRepositoryPull(pull, repository),
    );
  }
  if (!headPrefix) return filtered;
  return filtered.filter((pull) => pull.head.ref.startsWith(headPrefix));
}

export async function listBranchesWithPrefix(github, prefix) {
  const refs = await github(
    `/git/matching-refs/heads/${encodeURIComponent(prefix)}`,
    {},
    [404],
  );
  if (!refs) return [];
  return refs
    .map((ref) => ref.ref.replace(/^refs\/heads\//, ""))
    .filter((name) => name.startsWith(prefix));
}

export async function deleteBranch(github, branch) {
  const encoded = branch.split("/").map(encodeURIComponent).join("/");
  await github(`/git/refs/heads/${encoded}`, { method: "DELETE" }, [404, 422]);
}

export async function closePull(github, pullNumber, comment) {
  if (comment) {
    await github(`/issues/${pullNumber}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
  }
  await github(`/pulls/${pullNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed" }),
  });
}

export async function upsertPull(
  github,
  owner,
  { title, head, base, body, repository },
) {
  const headQualifier = head.includes(":") ? head : `${owner}:${head}`;
  const existing = await github(
    `/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(headQualifier)}&per_page=10`,
  );
  const repo =
    repository ??
    existing.find((pull) => pull.base?.repo?.full_name)?.base.repo.full_name ??
    null;
  const sameHead = existing.find(
    (pull) =>
      pull.head.ref === head &&
      (!repo || isSameRepositoryPull(pull, repo)),
  );
  if (sameHead) {
    return github(`/pulls/${sameHead.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
  }
  return github("/pulls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body }),
  });
}

export async function branchExists(github, branch) {
  const encoded = branch.split("/").map(encodeURIComponent).join("/");
  return Boolean(await github(`/branches/${encoded}`, {}, [404]));
}

// --- release-policy ---
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
export const APP = "frontend";
export const APP_MANIFEST = "package.json";
export const CHANGELOG_PATH = "CHANGELOG.md";

export const BRANCH_KINDS = Object.freeze({
  release: "release",
  hotfix: "hotfix",
  backmerge: "backmerge",
});

/** Long-lived bases that uniqueness / clearKind may target for PR closes. */
export const PERMANENT_BASE_BRANCHES = Object.freeze(["main", "develop"]);

/**
 * Refuse any base other than main/develop before uniqueness closes or deletes.
 * @param {unknown} base
 * @returns {"main" | "develop"}
 */
export function assertPermanentBaseBranch(base) {
  if (typeof base !== "string" || !PERMANENT_BASE_BRANCHES.includes(base)) {
    throw new TypeError(
      `BASE_BRANCH must be main or develop (got ${JSON.stringify(base)})`,
    );
  }
  return /** @type {"main" | "develop"} */ (base);
}

/** Paths that require a frontend changeset on develop PRs. */
export const PRODUCT_PATH_PREFIXES = Object.freeze([
  "packages/web/",
  "packages/mobile-new/",
  "packages/common/",
  "packages/universal-components/",
  "libs/",
]);

export const APP_PATH_PREFIXES = Object.freeze([
  "packages/web/",
  "packages/mobile-new/",
]);

export const SHARED_PATH_PREFIXES = Object.freeze([
  "packages/common/",
  "packages/universal-components/",
  "libs/",
]);

export function assertVersion(version, label = "package") {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new TypeError(`Invalid ${label} version: ${version}`);
  }
  return version;
}

export function parseSemver(version) {
  const match = assertVersion(version).match(SEMVER);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpVersion(version, type) {
  const { major, minor, patch } = parseSemver(version);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new TypeError(`Unknown bump type: ${type}`);
}

export function highestBump(types) {
  const set = types instanceof Set ? types : new Set(types);
  if (set.has("major")) return "major";
  if (set.has("minor")) return "minor";
  if (set.has("patch")) return "patch";
  return null;
}

export function versionedBranch(kind, version) {
  if (!Object.values(BRANCH_KINDS).includes(kind)) {
    throw new TypeError(`Unknown branch kind: ${kind}`);
  }
  return `${kind}/${assertVersion(version)}`;
}

export function parseVersionedBranch(branch) {
  const match = String(branch).match(
    /^(release|hotfix|backmerge)\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
  );
  if (!match) {
    throw new TypeError(
      "Expected release|hotfix|backmerge/<version> branch name",
    );
  }
  return { kind: match[1], version: match[2] };
}

export function isVersionedBranch(branch, kind) {
  try {
    const parsed = parseVersionedBranch(branch);
    return kind ? parsed.kind === kind : true;
  } catch {
    return false;
  }
}

export function releaseBranch(version) {
  return versionedBranch(BRANCH_KINDS.release, version);
}

export function hotfixBranch(version) {
  return versionedBranch(BRANCH_KINDS.hotfix, version);
}

export function backmergeBranch(version) {
  return versionedBranch(BRANCH_KINDS.backmerge, version);
}

export function pathHasPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

// --- release-notes ---
export function listCommitsBetween(fromRef, toRef = "HEAD") {
  return gitLines([
    "log",
    "--pretty=format:%h\t%s",
    "--no-merges",
    `${fromRef}..${toRef}`,
  ]).map((line) => {
    const tab = line.indexOf("\t");
    if (tab === -1) return { hash: line, subject: "" };
    return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}

export function formatCommitsMarkdown(commits) {
  if (commits.length === 0) return "_No non-merge commits in this release._";
  return commits
    .map(({ hash, subject }) => `- \`${hash}\` ${subject}`)
    .join("\n");
}

export function bumpHeading(bump) {
  if (bump === "major") return "Major Changes";
  if (bump === "minor") return "Minor Changes";
  return "Patch Changes";
}

export function extractVersionSection(changelog, version) {
  const lines = String(changelog).split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\d+\.\d+\.\d+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").replace(/\s+$/, "");
}

export function buildVersionSection({
  version,
  bump,
  summaryLines = [],
  commits = [],
}) {
  const summaries =
    summaryLines.length > 0
      ? summaryLines
      : ["Release from develop without pending changesets."];
  const parts = [
    `## ${version}`,
    "",
    `### ${bumpHeading(bump)}`,
    "",
    ...summaries.map((line) => `- ${line}`),
    "",
    "### Commits",
    "",
    formatCommitsMarkdown(commits),
    "",
  ];
  return parts.join("\n");
}

/**
 * Insert or replace the version section at the top of the root changelog.
 */
export function upsertChangelog(changelog, section, version) {
  const text = String(changelog || "").trim();
  const title = `# ${APP}`;
  const withoutVersion = text
    ? text
        .split("\n")
        .reduce(
          (state, line) => {
            if (line.trim() === `## ${version}`) {
              state.skipping = true;
              return state;
            }
            if (state.skipping && /^##\s+\d+\.\d+\.\d+/.test(line)) {
              state.skipping = false;
            }
            if (!state.skipping) state.lines.push(line);
            return state;
          },
          { skipping: false, lines: [] },
        )
        .lines.join("\n")
        .trim()
    : title;

  const body = withoutVersion.startsWith("#")
    ? withoutVersion.replace(/^#\s*[^\n]*\n?/, "").trim()
    : withoutVersion;
  return [`# ${APP}`, "", section.trim(), body ? `\n${body}\n` : "\n"].join(
    "\n",
  );
}

/**
 * Keep prior notes and append a Commits section (used if a section already exists).
 */
export function attachCommitsToChangelog(changelog, version, commits) {
  const section = extractVersionSection(changelog, version);
  if (!section) {
    return upsertChangelog(
      changelog,
      buildVersionSection({ version, bump: "patch", commits }),
      version,
    );
  }
  if (/^### Commits\s*$/m.test(section)) {
    return changelog;
  }
  const enriched = `${section.trim()}\n\n### Commits\n\n${formatCommitsMarkdown(commits)}\n`;
  return upsertChangelog(changelog, enriched, version);
}

export async function readChangelog(path = CHANGELOG_PATH) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return `# ${APP}\n`;
    throw error;
  }
}

export async function writeChangelog(contents, path = CHANGELOG_PATH) {
  await writeFile(
    path,
    contents.endsWith("\n") ? contents : `${contents}\n`,
    "utf8",
  );
}

export function releasePullBody({ version, branch, source, changelogSection }) {
  return [
    "<!-- stablehouse-release-summary:start -->",
    "## Release",
    "",
    `- Version: \`${version}\``,
    `- Branch: \`${branch}\``,
    `- Version source: \`${source}\``,
    "",
    "### Changelog",
    "",
    changelogSection?.trim() || `_No changelog section for ${version}._`,
    "",
    "Built from latest `main` with `develop` merged in, then versioned.",
    `After merge: tag \`frontend@${version}\` and open \`backmerge/${version}\` into develop (human merge; never squash).`,
    "<!-- stablehouse-release-summary:end -->",
  ].join("\n");
}

// --- changeset frontmatter ---
const RELEASE_TYPES = new Set(["patch", "minor", "major"]);

export function changesetTargets(contents) {
  return new Set(changesetReleases(contents).keys());
}

export function changesetReleases(contents) {
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!frontmatter) return new Map();

  const releases = new Map();
  for (const line of frontmatter[1].split("\n")) {
    const match = line.match(
      /^\s*["']?([^"' :]+)["']?\s*:\s*(patch|minor|major)\s*$/,
    );
    if (match && RELEASE_TYPES.has(match[2])) {
      releases.set(match[1], match[2]);
    }
  }
  return releases;
}

// --- compute-version ---
export async function pendingFrontendBumps(changesetDir = ".changeset") {
  const entries = await readdir(changesetDir, { withFileTypes: true });
  const bumps = new Set();
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.name === "README.md" ||
      !entry.name.endsWith(".md")
    ) {
      continue;
    }
    const contents = await readFile(`${changesetDir}/${entry.name}`, "utf8");
    const release = changesetReleases(contents).get(APP);
    if (release) bumps.add(release);
  }
  return bumps;
}

/** @deprecated Use pendingFrontendBumps */
export const pendingWebBumps = pendingFrontendBumps;

export async function readAppVersion(manifestPath = APP_MANIFEST) {
  const packageJson = JSON.parse(await readFile(manifestPath, "utf8"));
  return assertVersion(packageJson.version, APP);
}

/**
 * Next release version for the current working tree.
 * Uses the highest pending frontend changeset bump, or patch when there are
 * commit diffs but no changesets (chores / CI-driven releases).
 *
 * Does NOT invoke `changeset version` — workspace packages stay unversioned;
 * only root package.json (frontend) is bumped by prepare-release / hotfix.
 */
export async function computeNextVersion({
  requireChanges = false,
  hasCommitDiffs = false,
} = {}) {
  const current = await readAppVersion();
  const bumps = await pendingFrontendBumps();
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

/** Remove consumed changeset markdown after a direct root bump. */
export async function clearPendingChangesets(changesetDir = ".changeset") {
  const entries = await readdir(changesetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.name === "README.md" ||
      !entry.name.endsWith(".md")
    ) {
      continue;
    }
    await unlink(`${changesetDir}/${entry.name}`);
  }
}

// --- ensure-single-branch ---
/**
 * Keep exactly one branch of the given kind. Deletes every other
 * `kind/*` branch and closes its open same-repo pull request.
 * Fork / cross-repository PRs are ignored.
 */
export async function ensureSingleBranch(
  kind,
  keepBranch,
  {
    base,
    closeMessage = `Superseded by \`${keepBranch}\`. Only one ${kind}/X.X.X branch is kept open at a time.`,
  } = {},
) {
  if (!Object.values(BRANCH_KINDS).includes(kind)) {
    throw new TypeError(`Unknown branch kind: ${kind}`);
  }
  // Allowlist before any GitHub close/delete — covers PR and workflow_dispatch.
  const safeBase = assertPermanentBaseBranch(base);

  const { github, repository } = createGithubClient();
  const prefix = `${kind}/`;
  const branches = await listBranchesWithPrefix(github, prefix);
  const pulls = await listOpenPulls(github, {
    base: safeBase,
    headPrefix: prefix,
    repository,
  });

  for (const pull of pulls) {
    if (pull.head.ref === keepBranch) continue;
    await closePull(github, pull.number, closeMessage);
    console.log(`Closed PR #${pull.number} (${pull.head.ref}).`);
  }

  for (const branch of branches) {
    if (branch === keepBranch) continue;
    await deleteBranch(github, branch);
    console.log(`Deleted branch ${branch}.`);
  }

  return { branches, pulls };
}

export async function clearKind(kind, { base, closeMessage } = {}) {
  return ensureSingleBranch(kind, null, {
    base,
    closeMessage:
      closeMessage ?? `Closed because there is no active ${kind}/X.X.X branch.`,
  });
}

// --- sync-api-client ---
const ENVIRONMENTS = Object.freeze({
  prod: {
    script: "typings:prod",
    message: "Sync API client from prod swagger",
  },
  dev: {
    script: "typings:dev",
    message: "Sync API client from dev swagger",
  },
});

/**
 * Rebuild @xbto/api-client typings for the given environment and commit when dirty.
 * Fails loudly if typings fails. Callers must yarn install first.
 *
 * @param {"prod"|"dev"} environment
 * @returns {Promise<boolean>} true when a sync commit was created
 */
export async function syncApiClient(environment) {
  const config = ENVIRONMENTS[environment];
  if (!config) {
    throw new TypeError(`Unknown API sync environment: ${environment}`);
  }

  const result = spawnSync(
    "yarn",
    ["workspace", "@xbto/api-client", config.script],
    {
      encoding: "utf8",
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `API client typings (${config.script}) failed with exit ${result.status ?? "unknown"}`,
    );
  }

  runGit(["add", "-A", "--", "libs/api-client"]);
  const staged = gitOutput(["diff", "--cached", "--name-only"], {
    allowFailure: true,
  });
  if (!staged) {
    console.log(`API client already matches ${environment} swagger; no sync commit.`);
    return false;
  }

  configureBotIdentity();
  runGit(["commit", "-m", config.message]);
  console.log(`Committed: ${config.message}`);
  return true;
}

