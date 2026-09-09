import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const allowedApps = new Set(["web", "backoffice"]);
const app = process.argv[2];

if (!allowedApps.has(app)) {
  throw new TypeError(`Expected one of: ${[...allowedApps].join(", ")}`);
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const appDirectory = resolve(repositoryRoot, "apps", app);
const outputDirectory = resolve(appDirectory, "dist");
const moduleUrl = pathToFileURL(resolve(appDirectory, "src/render.js"));
const { renderPage } = await import(moduleUrl);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "index.html"), renderPage(), "utf8");

console.log(`Built ${app} into ${outputDirectory}`);
