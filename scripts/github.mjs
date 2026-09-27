const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createGithubClient({
  repository = process.env.GITHUB_REPOSITORY ?? "",
  token = process.env.GITHUB_TOKEN,
} = {}) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
  }
  if (!token) throw new TypeError("GITHUB_TOKEN is required");

  const [owner] = repository.split("/");
  const base = `https://api.github.com/repos/${repository}`;

  async function github(path, options = {}, allowedStatuses = []) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const detail = await response.text();
      throw new Error(`GitHub API ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (response.status === 204 || allowedStatuses.includes(response.status)) {
      return null;
    }
    return response.json();
  }

  return { owner, repository, github };
}

export async function listOpenPulls(github, { base, headPrefix } = {}) {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({
      state: "open",
      per_page: "100",
      page: String(page),
    });
    if (base) query.set("base", base);
    const batch = await github(`/pulls?${query}`);
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  if (!headPrefix) return pulls;
  return pulls.filter((pull) => pull.head.ref.startsWith(headPrefix));
}

export async function listBranchesWithPrefix(github, prefix) {
  const refs = await github(
    `/git/matching-refs/heads/${encodeURIComponent(prefix)}`,
    {},
    [404],
  );
  if (!refs) return [];
  return refs
    .map((ref) => ref.ref.replace(/^refs\/heads\//, ""))
    .filter((name) => name.startsWith(prefix));
}

export async function deleteBranch(github, branch) {
  const encoded = branch.split("/").map(encodeURIComponent).join("/");
  await github(`/git/refs/heads/${encoded}`, { method: "DELETE" }, [404, 422]);
}

export async function closePull(github, pullNumber, comment) {
  if (comment) {
    await github(`/issues/${pullNumber}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
  }
  await github(`/pulls/${pullNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed" }),
  });
}

export async function upsertPull(github, owner, { title, head, base, body }) {
  const headQualifier = head.includes(":") ? head : `${owner}:${head}`;
  const existing = await github(
    `/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(headQualifier)}&per_page=10`,
  );
  const sameHead = existing.find((pull) => pull.head.ref === head);
  if (sameHead) {
    const updated = await github(`/pulls/${sameHead.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    return updated;
  }
  return github("/pulls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body }),
  });
}

export async function branchExists(github, branch) {
  const encoded = branch.split("/").map(encodeURIComponent).join("/");
  return Boolean(await github(`/branches/${encoded}`, {}, [404]));
}
