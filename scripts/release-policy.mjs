const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertVersion(version, packageName) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new TypeError(`Invalid ${packageName} package version`);
  }
  return version;
}

export function selectTrainVersion(changedFiles, versions) {
  if (changedFiles.has("apps/web/package.json")) {
    return assertVersion(versions.web, "web");
  }
  if (changedFiles.has("apps/backoffice/package.json")) {
    return assertVersion(versions.backoffice, "backoffice");
  }
  throw new Error("Version PR did not change either app package");
}
