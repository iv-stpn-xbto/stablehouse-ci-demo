import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const changesetsCli = resolve("node_modules/@changesets/cli/bin.js");

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function versionFixture(changesets, ignoredApp) {
  const root = await mkdtemp(join(tmpdir(), "stablehouse-changesets-"));
  await Promise.all([
    mkdir(join(root, ".changeset"), { recursive: true }),
    mkdir(join(root, "apps/web"), { recursive: true }),
    mkdir(join(root, "apps/backoffice"), { recursive: true }),
    mkdir(join(root, "packages/common"), { recursive: true }),
  ]);

  await writeJson(join(root, "package.json"), {
    name: "fixture",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });
  for (const [path, name] of [
    ["apps/web", "web"],
    ["apps/backoffice", "backoffice"],
    ["packages/common", "common"],
  ]) {
    await writeJson(join(root, path, "package.json"), {
      name,
      version: "1.0.0",
      private: true,
    });
  }
  await writeJson(join(root, ".changeset/config.json"), {
    changelog: false,
    commit: false,
    fixed: [],
    linked: [],
    access: "restricted",
    baseBranch: "develop",
    updateInternalDependencies: "patch",
    ignore: [],
    privatePackages: { version: true, tag: false },
  });
  await Promise.all(
    Object.entries(changesets).map(([name, targets]) =>
      writeFile(
        join(root, `.changeset/${name}.md`),
        `---\n${Object.entries(targets)
          .map(([packageName, type]) => `"${packageName}": ${type}`)
          .join("\n")}\n---\n\nFixture release\n`,
        "utf8",
      ),
    ),
  );

  const args = [changesetsCli, "version"];
  if (ignoredApp) args.push("--ignore", ignoredApp);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const versions = {};
  for (const [path, name] of [
    ["apps/web", "web"],
    ["apps/backoffice", "backoffice"],
    ["packages/common", "common"],
  ]) {
    versions[name] = JSON.parse(
      await readFile(join(root, path, "package.json"), "utf8"),
    ).version;
  }
  const remainingChangesets = (await readdir(join(root, ".changeset")))
    .filter((name) => name.endsWith(".md"))
    .sort();
  await rm(root, { recursive: true, force: true });
  return { versions, remainingChangesets };
}

test("Changesets versions web independently", async () => {
  assert.deepEqual(await versionFixture({ web: { web: "patch" } }), {
    versions: {
      web: "1.0.1",
      backoffice: "1.0.0",
      common: "1.0.0",
    },
    remainingChangesets: [],
  });
});

test("Changesets versions backoffice independently", async () => {
  assert.deepEqual(await versionFixture({ backoffice: { backoffice: "minor" } }), {
    versions: {
      web: "1.0.0",
      backoffice: "1.1.0",
      common: "1.0.0",
    },
    remainingChangesets: [],
  });
});

test("a web release leaves the backoffice common changeset pending", async () => {
  assert.deepEqual(
    await versionFixture(
      {
        "common-web": { web: "patch" },
        "common-backoffice": { backoffice: "patch" },
      },
      "backoffice",
    ),
    {
      versions: {
        web: "1.0.1",
        backoffice: "1.0.0",
        common: "1.0.0",
      },
      remainingChangesets: ["common-backoffice.md"],
    },
  );
});

test("common stays unversioned during each app release", async () => {
  assert.deepEqual(await versionFixture({ web: { web: "minor" } }, "backoffice"), {
    versions: {
      web: "1.1.0",
      backoffice: "1.0.0",
      common: "1.0.0",
    },
    remainingChangesets: [],
  });
});
