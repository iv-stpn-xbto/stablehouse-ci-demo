import {
  closePull,
  createGithubClient,
  deleteBranch,
  listBranchesWithPrefix,
  listOpenPulls,
} from "./github.mjs";
import { BRANCH_KINDS } from "./release-policy.mjs";

/**
 * Keep exactly one branch of the given kind. Deletes every other
 * `kind/*` branch and closes its open pull request.
 */
export async function ensureSingleBranch(kind, keepBranch, {
  base,
  closeMessage = `Superseded by \`${keepBranch}\`. Only one ${kind}/X.X.X branch is kept open at a time.`,
} = {}) {
  if (!Object.values(BRANCH_KINDS).includes(kind)) {
    throw new TypeError(`Unknown branch kind: ${kind}`);
  }

  const { github } = createGithubClient();
  const prefix = `${kind}/`;
  const branches = await listBranchesWithPrefix(github, prefix);
  const pulls = await listOpenPulls(github, {
    base,
    headPrefix: prefix,
  });

  for (const pull of pulls) {
    if (pull.head.ref === keepBranch) continue;
    await closePull(github, pull.number, closeMessage);
    console.log(`Closed PR #${pull.number} (${pull.head.ref}).`);
  }

  for (const branch of branches) {
    if (branch === keepBranch) continue;
    await deleteBranch(github, branch);
    console.log(`Deleted branch ${branch}.`);
  }

  return { branches, pulls };
}

export async function clearKind(kind, { base, closeMessage } = {}) {
  return ensureSingleBranch(kind, null, {
    base,
    closeMessage:
      closeMessage ??
      `Closed because there is no active ${kind}/X.X.X branch.`,
  });
}
