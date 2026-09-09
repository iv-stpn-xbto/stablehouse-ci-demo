const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const APPS = Object.freeze(["web", "backoffice"]);

export function assertVersion(version, packageName) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new TypeError(`Invalid ${packageName} package version`);
  }
  return version;
}

export function assertApp(app) {
  if (!APPS.includes(app)) throw new TypeError(`Unknown application: ${app}`);
  return app;
}

export function releaseBranch(app, version) {
  return `release/${assertApp(app)}/${assertVersion(version, app)}`;
}

export function appFromReleaseBranch(branch) {
  const match = String(branch).match(
    /^release\/(web|backoffice)\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
  );
  if (!match) throw new TypeError("Expected release/<app>/<version> branch");
  return { app: match[1], version: match[2] };
}
