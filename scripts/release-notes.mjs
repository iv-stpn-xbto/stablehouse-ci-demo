import { readFile, writeFile } from "node:fs/promises";
import { APP } from "./release-policy.mjs";
import { gitLines } from "./git.mjs";

const CHANGELOG_PATH = `apps/${APP}/CHANGELOG.md`;

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

export function buildVersionSection({ version, bump, summaryLines = [], commits = [] }) {
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
 * Insert or replace the version section at the top of the package changelog.
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
  return [`# ${APP}`, "", section.trim(), body ? `\n${body}\n` : "\n"].join("\n");
}

/**
 * After `changeset version`, keep its notes and append a Commits section.
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
  await writeFile(path, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
}

export function releasePullBody({ version, branch, source, changelogSection, commits }) {
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
    "### Commits",
    "",
    formatCommitsMarkdown(commits),
    "",
    "Built from latest `main` with `develop` merged in, then versioned.",
    "<!-- stablehouse-release-summary:end -->",
  ].join("\n");
}
