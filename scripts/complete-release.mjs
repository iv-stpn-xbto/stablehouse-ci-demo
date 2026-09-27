import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createGithubClient, deleteBranch } from "./github.mjs";
import {
  APP,
  APP_MANIFEST,
  assertVersion,
  parseVersionedBranch,
} from "./release-policy.mjs";

async function completeRelease() {
  const mergeSha = process.env.MERGE_SHA ?? "";
  const branch = process.env.HEAD_BRANCH ?? "";
  if (!/^[0-9a-f]{40}$/.test(mergeSha)) {
    throw new TypeError("MERGE_SHA must be a full commit SHA");
  }

  const { kind, version } = parseVersionedBranch(branch);
  if (kind !== "release" && kind !== "hotfix") {
    throw new TypeError("Only release/* or hotfix/* merges complete a production version");
  }

  const { github } = createGithubClient();
  const manifest = await github(
    `/contents/${APP_MANIFEST.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(mergeSha)}`,
  );
  const packageJson = JSON.parse(
    Buffer.from(manifest.content, "base64").toString("utf8"),
  );
  const packageVersion = assertVersion(packageJson.version, APP);
  if (packageVersion !== version) {
    throw new Error(
      `Branch version ${version} does not match ${APP} package ${packageVersion}`,
    );
  }

  const tag = `${APP}@${version}`;
  const encodedTag = encodeURIComponent(tag);
  const existingTag = await github(`/git/ref/tags/${encodedTag}`, {}, [404]);
  if (existingTag && existingTag.object.sha !== mergeSha) {
    throw new Error(`Tag ${tag} already points to a different commit`);
  }
  if (!existingTag) {
    await github("/git/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: mergeSha }),
    });
  }

  await deleteBranch(github, branch);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `kind=${kind}\nversion=${version}\ntag=${tag}\n`,
      "utf8",
    );
  }
  console.log(`Completed ${tag} from ${kind} at ${mergeSha}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  completeRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
