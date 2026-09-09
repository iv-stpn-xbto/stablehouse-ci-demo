import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { APPS, assertApp } from "./release-policy.mjs";

const app = assertApp(process.argv[2]);
const ignoredApp = APPS.find((candidate) => candidate !== app);
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(root, "node_modules/@changesets/cli/bin.js");
const result = spawnSync(
  process.execPath,
  [cli, "version", "--ignore", ignoredApp],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
