import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RELEASE_TYPES = new Set(["patch", "minor", "major"]);
const VERSIONED_PACKAGES = new Set(["web", "backoffice"]);
const COMMON_CONSUMERS = Object.freeze(["web", "backoffice"]);

export function requiredPackagesForPaths(paths) {
  const required = new Set();

  for (const path of paths) {
    if (path.startsWith("apps/web/")) required.add("web");
    if (path.startsWith("apps/backoffice/")) required.add("backoffice");
    if (path.startsWith("packages/common/")) {
      required.add("web");
      required.add("backoffice");
    }
  }

  return required;
}

export function changesetTargets(contents) {
  return new Set(changesetReleases(contents).keys());
}

export function changesetReleases(contents) {
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!frontmatter) return new Map();

  const releases = new Map();
  for (const line of frontmatter[1].split("\n")) {
    const match = line.match(/^\s*["']?([^"' :]+)["']?\s*:\s*(patch|minor|major)\s*$/);
    if (match && RELEASE_TYPES.has(match[2])) {
      releases.set(match[1], match[2]);
    }
  }
  return releases;
}

export function missingTargets(paths, changesets) {
  const required = requiredPackagesForPaths(paths);
  const supplied = new Set(changesets.flatMap((contents) => [...changesetTargets(contents)]));
  return [...required].filter((name) => !supplied.has(name)).sort();
}

export function validationErrors(paths, entries, pullNumber) {
  const errors = [];
  const contents = entries.map((entry) => entry.contents);
  const missing = missingTargets(paths, contents);
  if (missing.length > 0) {
    errors.push(`Changed versioned code is missing changeset targets: ${missing.join(", ")}`);
  }

  for (const entry of entries) {
    const releases = changesetReleases(entry.contents);
    if (releases.has("common")) {
      errors.push(`${entry.path} must not version common`);
    }
    for (const name of releases.keys()) {
      if (name !== "common" && !VERSIONED_PACKAGES.has(name)) {
        errors.push(`${entry.path} targets unknown package ${name}`);
      }
    }
    const appTargets = [...releases.keys()].filter((name) => VERSIONED_PACKAGES.has(name));
    if (appTargets.length > 1) {
      errors.push(`${entry.path} targets multiple apps; use one changeset file per app`);
    }
  }

  if (paths.some((path) => path.startsWith("packages/common/"))) {
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
      errors.push("PR_NUMBER is required to validate generated common changesets");
    } else {
      for (const app of COMMON_CONSUMERS) {
        const generatedPath = `.changeset/common-pr-${pullNumber}-${app}.md`;
        const generated = entries.find((entry) => entry.path === generatedPath);
        if (changesetReleases(generated?.contents ?? "").get(app) !== "patch") {
          errors.push(`${generatedPath} must contain a generated ${app}: patch release`);
        }
      }
    }
  }

  return errors;
}

function changedPaths(base, head) {
  if (!/^[0-9A-Za-z_./-]+$/.test(base) || !/^[0-9A-Za-z_./-]+$/.test(head)) {
    throw new TypeError("Git refs contain unsupported characters");
  }

  const result = spawnSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to calculate changed files");
  }
  return result.stdout.split("\n").filter(Boolean);
}

async function changesetContents(paths) {
  const changedChangesets = paths.filter(
    (path) => path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md",
  );
  return Promise.all(
    changedChangesets.map(async (path) => ({ path, contents: await readFile(path, "utf8") })),
  );
}

async function main() {
  const [base, head = "HEAD"] = process.argv.slice(2);
  if (!base) {
    console.log("Usage: yarn check:changeset <base-ref> [head-ref]");
    return;
  }

  const paths = changedPaths(base, head);
  const errors = validationErrors(
    paths,
    await changesetContents(paths),
    Number(process.env.PR_NUMBER),
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log("Changeset scope matches changed versioned code.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
