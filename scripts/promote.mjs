const repository = process.env.GITHUB_REPOSITORY ?? "";
const token = process.env.GITHUB_TOKEN;

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
}
if (!token) throw new TypeError("GITHUB_TOKEN is required");

const [owner] = repository.split("/");
const base = `https://api.github.com/repos/${repository}`;
async function github(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

const [mainRef, developRef] = await Promise.all([
  github("/git/ref/heads/main"),
  github("/git/ref/heads/develop"),
]);
const [mainCommit, developCommit] = await Promise.all([
  github(`/git/commits/${mainRef.object.sha}`),
  github(`/git/commits/${developRef.object.sha}`),
]);
if (mainCommit.tree.sha === developCommit.tree.sha) {
  console.log("develop has no tree changes to promote.");
} else {
  const pulls = await github(
    `/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:develop`)}`,
  );
  if (pulls.length > 0) {
    console.log(`Promote PR already open: ${pulls[0].html_url}`);
  } else {
    const pull = await github("/pulls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Promote develop to main",
        head: "develop",
        base: "main",
        body: [
          "Promotes tested code and pending app changesets from `develop` to `main`.",
          "",
          "`main` means eligible to release. App production state is tracked by per-app tags and deployment environments.",
        ].join("\n"),
      }),
    });
    console.log(`Created promote PR: ${pull.html_url}`);
  }
}
