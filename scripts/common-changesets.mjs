const CONSUMERS = Object.freeze(["web", "backoffice"]);
const COMMON_PREFIX = "packages/common/";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function generatedFileName(pullNumber, app) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("Pull request number must be a positive integer");
  }
  if (!CONSUMERS.includes(app)) throw new TypeError(`Unknown common consumer: ${app}`);
  return `.changeset/common-pr-${pullNumber}-${app}.md`;
}

export function generatedChangeset(app, title) {
  if (!CONSUMERS.includes(app)) throw new TypeError(`Unknown common consumer: ${app}`);
  const summary = String(title)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!summary) throw new TypeError("Pull request title must contain visible text");

  return `---
"${app}": patch
---

Shared common change: ${summary}
`;
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
    const batch = await github(`/pulls/${pullNumber}/files?per_page=100&page=${page}`);
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
      message: `Add common consumer changeset for PR #${pullNumber}`,
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
      message: `Remove stale common changeset for PR #${pullNumber}`,
      sha: existing.sha,
      branch,
    }),
  });
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const pullNumber = Number(process.env.PR_NUMBER);
  const title = process.env.PR_TITLE ?? "";
  const github = apiClient(repository, process.env.GITHUB_TOKEN);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("PR_NUMBER must be a positive integer");
  }

  const pull = await github(`/pulls/${pullNumber}`);
  if (pull.head.repo.full_name !== repository) {
    throw new Error("Common changeset automation only writes to same-repository PR branches");
  }
  const branch = pull.head.ref;
  if (!BRANCH_PATTERN.test(branch) || branch.startsWith("/") || branch.includes("..")) {
    throw new TypeError("Pull request branch contains unsupported characters");
  }

  const touchesCommon = (await pullFiles(github, pullNumber)).some((file) =>
    file.filename.startsWith(COMMON_PREFIX),
  );

  for (const app of CONSUMERS) {
    const path = generatedFileName(pullNumber, app);
    if (touchesCommon) {
      await upsert(github, path, branch, generatedChangeset(app, title), pullNumber);
    } else {
      await remove(github, path, branch, pullNumber);
    }
  }

  console.log(
    touchesCommon
      ? `Generated patch changesets for: ${CONSUMERS.join(", ")}`
      : "No common changes remain; generated changesets are absent.",
  );
}

if (process.argv[1]?.endsWith("common-changesets.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
