import { githubRequest } from "./github.mjs";

const token = process.env.PUBLISHER_GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const branch = process.env.PUBLISH_BRANCH;
const headSha = process.env.PUBLISH_HEAD_SHA;
const postDate = process.env.POST_DATE;
const checkName = "build-in-public-ci";

if (!token || !repository || !branch || !headSha || !postDate) {
  throw new Error("Publisher token, repository, branch, head SHA, and post date are required.");
}

const [owner, repo] = repository.split("/");
const repositoryDetails = await githubRequest(token, `/repos/${owner}/${repo}`);
const pulls = await githubRequest(
  token,
  `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`
);

const pullRequest = pulls[0] ?? await githubRequest(token, `/repos/${owner}/${repo}/pulls`, {
  method: "POST",
  body: {
    title: `build in public: ${postDate}`,
    head: branch,
    base: repositoryDetails.default_branch,
    body: [
      "automated weekly build-in-public post.",
      "",
      "the content passed privacy, grounding, spelling, lint, and production build checks before this pull request was opened.",
    ].join("\n"),
  },
});

console.log(`Opened or found pull request #${pullRequest.number}.`);

const deadline = Date.now() + 30 * 60 * 1000;
let completedCheck;
while (Date.now() < deadline) {
  const headCheckRuns = await githubRequest(
    token,
    `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`
  );
  let availableCheckRuns = headCheckRuns.check_runs;
  if (!availableCheckRuns.some((check) => check.name === checkName)) {
    const latestPullRequest = await githubRequest(
      token,
      `/repos/${owner}/${repo}/pulls/${pullRequest.number}`
    );
    if (latestPullRequest.merge_commit_sha && latestPullRequest.merge_commit_sha !== headSha) {
      const mergeCheckRuns = await githubRequest(
        token,
        `/repos/${owner}/${repo}/commits/${latestPullRequest.merge_commit_sha}/check-runs?per_page=100`
      );
      availableCheckRuns = [...availableCheckRuns, ...mergeCheckRuns.check_runs];
    }
  }
  const matches = availableCheckRuns
    .filter((check) => check.name === checkName)
    .sort((left, right) => String(right.started_at).localeCompare(String(left.started_at)));
  completedCheck = matches[0]?.status === "completed" ? matches[0] : undefined;

  if (completedCheck) break;
  console.log(`Waiting for ${checkName} on pull request #${pullRequest.number}...`);
  await new Promise((resolve) => setTimeout(resolve, 15000));
}

if (!completedCheck) {
  throw new Error(`${checkName} did not complete within 30 minutes.`);
}
if (completedCheck.conclusion !== "success") {
  throw new Error(`${checkName} concluded with ${completedCheck.conclusion}.`);
}

let merge;
while (Date.now() < deadline) {
  try {
    merge = await githubRequest(token, `/repos/${owner}/${repo}/pulls/${pullRequest.number}/merge`, {
      method: "PUT",
      body: {
        commit_title: `build in public: ${postDate} (#${pullRequest.number})`,
        merge_method: "squash",
        sha: headSha,
      },
    });
    if (merge.merged) break;
  } catch (error) {
    if (![405, 409].includes(error.status)) throw error;
  }
  console.log(`Waiting for remaining merge requirements on pull request #${pullRequest.number}...`);
  await new Promise((resolve) => setTimeout(resolve, 15000));
}

if (!merge?.merged) {
  throw new Error(`Pull request #${pullRequest.number} did not become mergeable within 30 minutes.`);
}
console.log(`Merged pull request #${pullRequest.number} as ${merge.sha}.`);

await githubRequest(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
  method: "DELETE",
});
console.log(`Deleted branch ${branch}.`);
