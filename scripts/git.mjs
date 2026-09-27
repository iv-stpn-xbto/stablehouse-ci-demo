import { spawnSync } from "node:child_process";

export function runGit(args, { allowFailure = false, input } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args[0]} failed`);
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
  };
}

export function gitLines(args, options) {
  const { stdout, status } = runGit(args, { allowFailure: true, ...options });
  if (status !== 0) return [];
  return stdout.split("\n").filter(Boolean);
}

export function gitOutput(args, options) {
  return runGit(args, options).stdout.trim();
}

export function configureBotIdentity() {
  runGit(["config", "user.name", "github-actions[bot]"]);
  runGit([
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
}
