import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RELEASE_TYPES = new Set(["patch", "minor", "major"]);
const VERSIONED_PACKAGES = new Set(["web", "backoffice"]);

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
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!frontmatter) return new Set();

  const targets = new Set();
  for (const line of frontmatter[1].split("\n")) {
    const match = line.match(/^\s*["']?([^"' :]+)["']?\s*:\s*(patch|minor|major)\s*$/);
    if (match && VERSIONED_PACKAGES.has(match[1]) && RELEASE_TYPES.has(match[2])) {
      targets.add(match[1]);
    }
  }
  return targets;
}

export function missingTargets(paths, changesets) {
  const required = requiredPackagesForPaths(paths);
  const supplied = new Set(changesets.flatMap((contents) => [...changesetTargets(contents)]));
  return [...required].filter((name) => !supplied.has(name)).sort();
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
  return Promise.all(changedChangesets.map((path) => readFile(path, "utf8")));
}

async function main() {
  const [base, head = "HEAD"] = process.argv.slice(2);
  if (!base) {
    console.log("Usage: yarn check:changeset <base-ref> [head-ref]");
    return;
  }

  const paths = changedPaths(base, head);
  const missing = missingTargets(paths, await changesetContents(paths));
  if (missing.length > 0) {
    throw new Error(
      `Changed versioned code is missing changeset targets: ${missing.join(", ")}`,
    );
  }

  console.log("Changeset scope matches changed versioned code.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
