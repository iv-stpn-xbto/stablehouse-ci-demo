const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
export const APP = "web";
export const APP_MANIFEST = "apps/web/package.json";

export const BRANCH_KINDS = Object.freeze({
  release: "release",
  hotfix: "hotfix",
  backmerge: "backmerge",
});

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
