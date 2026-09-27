import { appendFile, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { APP, APP_MANIFEST } from "./release-policy.mjs";
import { changesetTargets } from "./check-changeset-scope.mjs";
import { computeNextVersion } from "./compute-version.mjs";

const currentRef = process.env.GITHUB_REF_NAME ?? "HEAD";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

async function pendingChangesets() {
  const entries = await readdir(".changeset", { withFileTypes: true });
  const pending = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "README.md" || !entry.name.endsWith(".md")) {
      continue;
    }
    const path = `.changeset/${entry.name}`;
    if (changesetTargets(await readFile(path, "utf8")).has(APP)) {
      pending.push(path);
    }
  }
  return pending.sort();
}

const packageJson = JSON.parse(await readFile(APP_MANIFEST, "utf8"));
const [latestTag] = git(["tag", "--list", `${APP}@*`, "--sort=-v:refname"]);
const changedFiles = latestTag
  ? git([
      "diff",
      "--name-only",
      `${latestTag}...HEAD`,
      "--",
      "apps/web",
      "packages/common",
    ])
  : git(["ls-tree", "-r", "--name-only", "HEAD", "--", "apps/web", "packages/common"]);
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
  `- Unreleased app/shared files since tag: ${changedFiles.length}`,
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
