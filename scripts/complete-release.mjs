import { appendFile } from "node:fs/promises";
import { appFromReleaseBranch } from "./release-policy.mjs";

const repository = process.env.GITHUB_REPOSITORY ?? "";
const token = process.env.GITHUB_TOKEN;
const mergeSha = process.env.MERGE_SHA ?? "";
const branch = process.env.HEAD_BRANCH ?? "";

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
}
if (!token) throw new TypeError("GITHUB_TOKEN is required");
if (!/^[0-9a-f]{40}$/.test(mergeSha)) throw new TypeError("MERGE_SHA must be a full commit SHA");
const { app, version } = appFromReleaseBranch(branch);
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
  if (response.status === 204 || allowedStatuses.includes(response.status)) return null;
  return response.json();
}

const manifest = await github(
  `/contents/apps/${app}/package.json?ref=${encodeURIComponent(mergeSha)}`,
);
const packageJson = JSON.parse(Buffer.from(manifest.content, "base64").toString("utf8"));
if (packageJson.version !== version) {
  throw new Error(`Branch version ${version} does not match ${app} package ${packageJson.version}`);
}

const tag = `${app}@${version}`;
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

await github(
  `/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
  { method: "DELETE" },
  [404, 422],
);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `app=${app}\nversion=${version}\ntag=${tag}\n`,
    "utf8",
  );
}
console.log(`Completed ${tag} at ${mergeSha}.`);
