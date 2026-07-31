import fs from "node:fs/promises";
import { githubRequest } from "./github.mjs";
import {
  isGeneratedPostCommit,
  isProductionDeploymentEnvironment,
} from "./deployment.mjs";

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return Promise.resolve();
  return fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.DEPLOYMENT_SHA;
const state = process.env.DEPLOYMENT_STATE;
const environment = process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown environment";

if (!token || !repository || !sha || !state) {
  throw new Error("GitHub token, repository, deployment SHA, and deployment state are required.");
}

const [owner, repo] = repository.split("/");
const commit = await githubRequest(token, `/repos/${owner}/${repo}/commits/${sha}`);
const subject = commit.commit?.message?.split("\n")[0] ?? "";
const isGeneratedPost = isGeneratedPostCommit(commit);
const isProduction = isProductionDeploymentEnvironment(environment);
const failed = ["error", "failure"].includes(state);

await setOutput("notify", String(isGeneratedPost && isProduction && failed));
await setOutput("commit_subject", subject.replace(/[\r\n]+/g, " "));
await setOutput("environment", environment.replace(/[\r\n]+/g, " "));
console.log(
  isGeneratedPost
    ? `Observed ${state} ${isProduction ? "production" : "non-production"} deployment for generated post commit.`
    : "Deployment is unrelated to a generated build-in-public post."
);
