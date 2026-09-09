import { appendFile, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { APPS } from "./release-policy.mjs";
import { changesetTargets } from "./check-changeset-scope.mjs";

const currentRef = process.env.GITHUB_REF_NAME ?? "HEAD";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

async function pendingFor(app) {
  const entries = await readdir(".changeset", { withFileTypes: true });
  const pending = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "README.md" || !entry.name.endsWith(".md")) continue;
    const path = `.changeset/${entry.name}`;
    if (changesetTargets(await readFile(path, "utf8")).has(app)) pending.push(path);
  }
  return pending.sort();
}

async function appStatus(app) {
  const packageJson = JSON.parse(await readFile(`apps/${app}/package.json`, "utf8"));
  const [latestTag] = git(["tag", "--list", `${app}@*`, "--sort=-v:refname"]);
  const relevantPaths = [`apps/${app}`, "packages/common"];
  const changedFiles = latestTag
    ? git(["diff", "--name-only", `${latestTag}...HEAD`, "--", ...relevantPaths])
    : git(["ls-tree", "-r", "--name-only", "HEAD", "--", ...relevantPaths]);
  const pending = await pendingFor(app);
  const compareUrl =
    latestTag && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/compare/${encodeURIComponent(latestTag)}...${encodeURIComponent(currentRef)}`
      : null;
  const environmentUrl = process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/deployments/${encodeURIComponent(`production-${app}`)}`
    : null;

  return [
    `## ${app}`,
    "",
    `- Version on main: \`${packageJson.version}\``,
    `- Latest released tag: ${latestTag ? `\`${latestTag}\`` : "_none yet_"}`,
    ...(environmentUrl
      ? [`- [Production environment: production-${app}](${environmentUrl})`]
      : []),
    `- Pending changesets: ${pending.length}`,
    ...pending.map((path) => `  - \`${path}\``),
    `- Unreleased app/shared files since tag: ${changedFiles.length}`,
    ...changedFiles.slice(0, 25).map((path) => `  - \`${path}\``),
    ...(changedFiles.length > 25 ? [`  - _and ${changedFiles.length - 25} more_`] : []),
    ...(compareUrl ? [`- [Compare released ${app} with main](${compareUrl})`] : []),
    "",
  ].join("\n");
}

const summary = [
  "# Per-app release status",
  "",
  `Status for \`${currentRef}\`. Tags and production environments identify released code.`,
  "",
  ...(await Promise.all(APPS.map(appStatus))),
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
}
console.log(summary);
