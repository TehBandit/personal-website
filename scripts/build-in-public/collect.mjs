import { githubPaginate, githubPaginateObject, githubRequest } from "./github.mjs";
import { normalizeIdentity } from "./config.mjs";
import {
  categorizeFile,
  containsSensitivePattern,
  sanitizeText,
  shouldExcludePath,
} from "./sanitize.mjs";

export function isConfiguredAuthor(commit, config) {
  const allowedLogins = new Set(config.authorLogins.map(normalizeIdentity));
  const allowedEmails = new Set(config.authorEmails.map(normalizeIdentity));
  const login = normalizeIdentity(commit.author?.login);
  const email = normalizeIdentity(commit.commit?.author?.email);
  return allowedLogins.has(login) || allowedEmails.has(email);
}

export function isAutomationActor(commit) {
  const login = normalizeIdentity(commit.author?.login);
  const name = normalizeIdentity(commit.commit?.author?.name);
  return login.endsWith("[bot]") || name.endsWith("[bot]") ||
    name.includes("build in public") || name === "vercel";
}

export function isCommitInWindow(commit, window) {
  const committedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
  const timestamp = Date.parse(committedAt);
  const start = Date.parse(window.apiSince);
  const end = Date.parse(window.apiUntil);
  return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
}

function repositoryLabel(repository, privateIndex, config) {
  const configured = config.publicRepositoryLabels[repository.full_name];
  if (configured) return configured;
  if (repository.private) return `a private project ${privateIndex}`;
  return repository.name.replace(/[-_]+/g, " ").toLowerCase();
}

function productionBranchFor(repository, config) {
  return config.productionBranchOverrides[repository.full_name] ?? repository.default_branch;
}

export function assertRepositoryEvidenceWithinLimits(enriched, evidence, config) {
  const repositoryEvidenceCharacters = new Map();
  for (let index = 0; index < enriched.length; index += 1) {
    const repository = enriched[index].repositoryFullName;
    const characters = JSON.stringify(evidence[index]).length;
    const total = (repositoryEvidenceCharacters.get(repository) ?? 0) + characters;
    repositoryEvidenceCharacters.set(repository, total);
    if (total > config.maximumEvidenceCharactersPerRepository) {
      throw new Error(
        `Sanitized evidence for ${enriched[index].projectLabel} exceeds the per-repository privacy and cost ceiling.`
      );
    }
  }
}

export function consolidatePullRequestEvidence(commits) {
  const grouped = new Map();
  for (const commit of commits) {
    const key = commit.pullRequestNumber
      ? `${commit.repositoryFullName}#${commit.pullRequestNumber}`
      : `${commit.repositoryFullName}@${commit.sha}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...commit,
        changedAreas: [...commit.changedAreas],
        patches: [...commit.patches],
      });
      continue;
    }

    existing.status = existing.status === "production" || commit.status === "production"
      ? "production"
      : "development";
    existing.changedAreas = [...new Set([...existing.changedAreas, ...commit.changedAreas])].sort();
    existing.patches = [...new Set([...existing.patches, ...commit.patches])];
    existing.fileCount += commit.fileCount;
    existing.additions += commit.additions;
    existing.deletions += commit.deletions;
    existing.sourceText = `${existing.sourceText}\n${commit.sourceText}`.trim();
    if (!existing.commitSummary && commit.commitSummary) existing.commitSummary = commit.commitSummary;
    if (String(commit.committedAt) > String(existing.committedAt)) {
      existing.committedAt = commit.committedAt;
    }
  }
  return [...grouped.values()].sort((left, right) =>
    String(left.committedAt).localeCompare(String(right.committedAt))
  );
}

export function redactPrivateProjectName(value, commit) {
  if (commit.repositoryVisibility !== "private") return value;
  const repositoryName = commit.repositoryFullName.split("/").at(-1) ?? "";
  const terms = [
    commit.repositoryFullName,
    repositoryName,
    repositoryName.replace(/[-_]+/g, " "),
  ].filter((term) => term.length >= 3);

  let redacted = value;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    redacted = redacted.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "[private project]");
  }
  return redacted;
}

function repositoryCollectionError(error, repository, projectLabel) {
  if (!repository.private) return error;
  const message = redactPrivateProjectName(String(error?.message ?? error), {
    repositoryVisibility: "private",
    repositoryFullName: repository.full_name,
  });
  return new Error(`Collector failed while processing ${projectLabel}: ${message}`);
}

async function listOwnedRepositories(token, config) {
  const response = await githubPaginateObject(
    token,
    "/installation/repositories",
    "repositories",
    { maximumPages: Math.ceil(config.maximumRepositories / 100) + 1 }
  );
  const repositories = response
    .filter((repository) => normalizeIdentity(repository.owner?.login) === normalizeIdentity(config.owner));

  if (repositories.length > config.maximumRepositories) {
    throw new Error(
      `Collector found ${repositories.length} repositories, above the configured maximum of ${config.maximumRepositories}.`
    );
  }
  return repositories.sort((left, right) => left.full_name.localeCompare(right.full_name));
}

async function listBranchCommits(token, repository, branch, window) {
  const route = `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/commits` +
    `?sha=${encodeURIComponent(branch.name)}` +
    `&since=${encodeURIComponent(window.apiSince)}` +
    `&until=${encodeURIComponent(window.apiUntil)}`;
  return githubPaginate(token, route, { maximumPages: 10 });
}

async function enrichCommit(token, commit, config) {
  const [owner, repository] = commit.repositoryFullName.split("/");
  const details = await githubRequest(token, `/repos/${owner}/${repository}/commits/${commit.sha}`);
  const pullRequests = await githubRequest(
    token,
    `/repos/${owner}/${repository}/commits/${commit.sha}/pulls`
  );
  const files = Array.isArray(details.files) ? details.files : [];
  const eligibleFiles = files
    .filter((file) => !shouldExcludePath(file.filename))
    .slice(0, config.maximumFilesPerCommit);

  const sourceText = [];
  const sanitizedPatches = [];
  const changedAreas = new Set();

  for (const file of eligibleFiles) {
    changedAreas.add(categorizeFile(file.filename));
    if (!file.patch || containsSensitivePattern(file.patch)) continue;
    sourceText.push(file.patch);
    const patch = sanitizeText(file.patch, {
      maximumCharacters: config.maximumPatchCharactersPerFile,
    });
    if (patch) sanitizedPatches.push(redactPrivateProjectName(patch, commit));
  }

  const pullRequest = Array.isArray(pullRequests) ? pullRequests[0] : null;
  return {
    ...commit,
    commitSummary: redactPrivateProjectName(
      sanitizeText(details.commit?.message?.split("\n")[0] ?? "", { maximumCharacters: 240 }),
      commit
    ),
    pullRequestTitle: redactPrivateProjectName(
      sanitizeText(pullRequest?.title ?? "", { maximumCharacters: 240 }),
      commit
    ),
    pullRequestDescription: redactPrivateProjectName(
      sanitizeText(pullRequest?.body ?? "", { maximumCharacters: 1200 }),
      commit
    ),
    pullRequestNumber: pullRequest?.number ?? null,
    changedAreas: [...changedAreas].sort(),
    fileCount: files.length,
    additions: details.stats?.additions ?? 0,
    deletions: details.stats?.deletions ?? 0,
    patches: sanitizedPatches,
    sourceText: sourceText.join("\n"),
  };
}

export async function collectWeeklyEvidence({ token, config, window }) {
  if (!token) throw new Error("Collector GitHub token is required.");

  const repositories = await listOwnedRepositories(token, config);
  if (repositories.length === 0) {
    throw new Error("The collector GitHub App returned no repositories owned by TehBandit.");
  }

  const privateRepositories = repositories.filter((repository) => repository.private);
  const privateIndexes = new Map(
    privateRepositories.map((repository, index) => [repository.full_name, index + 1])
  );
  const commitsBySha = new Map();

  for (const repository of repositories) {
    const label = repositoryLabel(
      repository,
      privateIndexes.get(repository.full_name) ?? 0,
      config
    );
    let branches;
    try {
      branches = await githubPaginate(
        token,
        `/repos/${repository.owner.login}/${repository.name}/branches`,
        { maximumPages: Math.ceil(config.maximumBranchesPerRepository / 100) + 1 }
      );
    } catch (error) {
      throw repositoryCollectionError(error, repository, label);
    }

    if (branches.length > config.maximumBranchesPerRepository) {
      throw new Error(
        `${label} has more than ${config.maximumBranchesPerRepository} branches; refusing a partial summary.`
      );
    }

    const productionBranch = productionBranchFor(repository, config);

    for (const branch of branches) {
      let commits;
      try {
        commits = await listBranchCommits(token, repository, branch, window);
      } catch (error) {
        throw repositoryCollectionError(error, repository, label);
      }
      for (const commit of commits) {
        if (!isCommitInWindow(commit, window)) continue;
        if (!isConfiguredAuthor(commit, config) || isAutomationActor(commit)) continue;
        if ((commit.parents?.length ?? 0) > 1) continue;

        const existing = commitsBySha.get(commit.sha);
        if (existing) {
          existing.branches.add(branch.name);
          existing.status = classifyBranchMembership([...existing.branches], productionBranch);
          continue;
        }

        commitsBySha.set(commit.sha, {
          sha: commit.sha,
          repositoryFullName: repository.full_name,
          projectLabel: label,
          repositoryVisibility: repository.private ? "private" : "public",
          status: classifyBranchMembership([branch.name], productionBranch),
          branches: new Set([branch.name]),
          committedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date,
        });
      }
    }
  }

  if (commitsBySha.size > config.maximumQualifyingCommits) {
    throw new Error(
      `Collector found ${commitsBySha.size} qualifying commits, above the configured maximum of ${config.maximumQualifyingCommits}.`
    );
  }

  const commits = [...commitsBySha.values()].sort((left, right) =>
    String(left.committedAt).localeCompare(String(right.committedAt))
  );
  const enriched = [];
  for (const commit of commits) {
    try {
      enriched.push(await enrichCommit(token, commit, config));
    } catch (error) {
      if (commit.repositoryVisibility === "private") {
        const message = redactPrivateProjectName(String(error?.message ?? error), commit);
        throw new Error(`Collector failed while processing ${commit.projectLabel}: ${message}`);
      }
      throw error;
    }
  }

  const consolidated = consolidatePullRequestEvidence(enriched);

  const evidence = consolidated.map((commit, index) => ({
    id: `e${index + 1}`,
    project: commit.projectLabel,
    visibility: commit.repositoryVisibility,
    status: commit.status,
    summary: commit.commitSummary,
    pullRequestTitle: commit.pullRequestTitle,
    pullRequestDescription: commit.pullRequestDescription,
    changedAreas: commit.changedAreas,
    changeSize: {
      files: commit.fileCount,
      additions: commit.additions,
      deletions: commit.deletions,
    },
    sanitizedPatches: commit.patches,
  }));

  assertRepositoryEvidenceWithinLimits(consolidated, evidence, config);

  return {
    repositoryCount: repositories.length,
    evidence,
    sourceTexts: consolidated.map((commit) => commit.sourceText).filter(Boolean),
  };
}

export function classifyBranchMembership(branches, productionBranch) {
  return branches.includes(productionBranch) ? "production" : "development";
}
