import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const changesetsCli = resolve("node_modules/@changesets/cli/bin.js");

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function versionFixture(targets) {
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
    ignore: ["common"],
    privatePackages: { version: true, tag: false },
  });
  await writeFile(
    join(root, ".changeset/demo.md"),
    `---\n${Object.entries(targets)
      .map(([name, type]) => `"${name}": ${type}`)
      .join("\n")}\n---\n\nFixture release\n`,
    "utf8",
  );

  const result = spawnSync(process.execPath, [changesetsCli, "version"], {
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
  await assert.rejects(readFile(join(root, ".changeset/demo.md"), "utf8"));
  await rm(root, { recursive: true, force: true });
  return versions;
}

test("Changesets versions web independently", async () => {
  assert.deepEqual(await versionFixture({ web: "patch" }), {
    web: "1.0.1",
    backoffice: "1.0.0",
    common: "1.0.0",
  });
});

test("Changesets versions backoffice independently", async () => {
  assert.deepEqual(await versionFixture({ backoffice: "minor" }), {
    web: "1.0.0",
    backoffice: "1.1.0",
    common: "1.0.0",
  });
});

test("a shared changeset versions both app consumers", async () => {
  assert.deepEqual(await versionFixture({ web: "minor", backoffice: "patch" }), {
    web: "1.1.0",
    backoffice: "1.0.1",
    common: "1.0.0",
  });
});
