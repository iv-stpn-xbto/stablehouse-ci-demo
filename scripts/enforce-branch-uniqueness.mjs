import { fileURLToPath } from "node:url";
import { ensureSingleBranch } from "./ensure-single-branch.mjs";
import { parseVersionedBranch } from "./release-policy.mjs";

async function main() {
  const branch = process.env.HEAD_BRANCH ?? process.argv[2];
  const base = process.env.BASE_BRANCH ?? process.argv[3];
  if (!branch || !base) {
    throw new TypeError(
      "Usage: HEAD_BRANCH and BASE_BRANCH env vars, or enforce-branch-uniqueness.mjs <head> <base>",
    );
  }

  const { kind } = parseVersionedBranch(branch);
  await ensureSingleBranch(kind, branch, { base });
  console.log(`Ensured ${branch} is the only open ${kind}/* branch.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
