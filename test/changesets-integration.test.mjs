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

async function versionFixture(changesets) {
  const root = await mkdtemp(join(tmpdir(), "stablehouse-changesets-"));
  await Promise.all([
    mkdir(join(root, ".changeset"), { recursive: true }),
    mkdir(join(root, "apps/web"), { recursive: true }),
    mkdir(join(root, "packages/common"), { recursive: true }),
  ]);

  await writeJson(join(root, "package.json"), {
    name: "fixture",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });
  await writeJson(join(root, "apps/web/package.json"), {
    name: "web",
    version: "1.0.0",
    private: true,
  });
  await writeJson(join(root, "packages/common/package.json"), {
    name: "common",
    version: "0.0.0",
    private: true,
  });
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

  const result = spawnSync(process.execPath, [changesetsCli, "version"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const web = JSON.parse(await readFile(join(root, "apps/web/package.json"), "utf8"));
  const common = JSON.parse(
    await readFile(join(root, "packages/common/package.json"), "utf8"),
  );
  const remainingChangesets = (await readdir(join(root, ".changeset")))
    .filter((name) => name.endsWith(".md"))
    .sort();
  await rm(root, { recursive: true, force: true });
  return {
    versions: { web: web.version, common: common.version },
    remainingChangesets,
  };
}

test("Changesets versions web from a patch entry", async () => {
  assert.deepEqual(await versionFixture({ web: { web: "patch" } }), {
    versions: { web: "1.0.1", common: "0.0.0" },
    remainingChangesets: [],
  });
});

test("Changesets versions web from a minor entry", async () => {
  assert.deepEqual(await versionFixture({ web: { web: "minor" } }), {
    versions: { web: "1.1.0", common: "0.0.0" },
    remainingChangesets: [],
  });
});

test("common stays ignored while web versions", async () => {
  assert.deepEqual(await versionFixture({ web: { web: "major" } }), {
    versions: { web: "2.0.0", common: "0.0.0" },
    remainingChangesets: [],
  });
});
