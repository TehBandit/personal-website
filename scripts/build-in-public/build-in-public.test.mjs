import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertRepositoryEvidenceWithinLimits,
  classifyBranchMembership,
  collectWeeklyEvidence,
  consolidatePullRequestEvidence,
  isAutomationActor,
  isCommitInWindow,
  isConfiguredAuthor,
  limitEvidenceWithinCharacterBudgets,
  redactPrivateProjectName,
} from "./collect.mjs";
import { normalizeProjectUrl, summarizeProjects } from "./project-metadata.mjs";
import { addedImageCandidate, prepareProjectMedia } from "./media.mjs";
import { githubPaginateObject, githubRequest } from "./github.mjs";
import { openAIGeneratedPostSchema } from "./schema.mjs";
import {
  isGeneratedPostCommit,
  isProductionDeploymentEnvironment,
} from "./deployment.mjs";
import { sanitizeText, shouldExcludePath } from "./sanitize.mjs";
import { validateGeneratedPost } from "./validate.mjs";
import { calculateWeeklyWindow } from "./window.mjs";

test("weekly window uses Sunday noon in New York and is end-exclusive", () => {
  const beforeNoon = calculateWeeklyWindow({ now: new Date("2026-07-26T15:59:00Z") });
  assert.equal(beforeNoon.date, "2026-07-19");
  const atNoon = calculateWeeklyWindow({ now: new Date("2026-07-26T16:00:00Z") });
  assert.equal(atNoon.date, "2026-07-26");
  assert.equal(atNoon.apiSince, "2026-07-19T16:00:00Z");
  assert.equal(atNoon.apiUntil, "2026-07-26T16:00:00Z");
  assert.equal(atNoon.title, "Devlog: July 19, 2026 - July 26, 2026");
});

test("weekly window preserves local noon across daylight saving changes", () => {
  const window = calculateWeeklyWindow({ explicitWindowEnd: "2026-03-08" });
  assert.match(window.periodStart, /T12:00:00-05:00$/);
  assert.match(window.periodEnd, /T12:00:00-04:00$/);
});

test("commit filtering treats the weekly window as half-open", () => {
  const window = {
    apiSince: "2026-07-19T16:00:00Z",
    apiUntil: "2026-07-26T16:00:00Z",
  };
  const commitAt = (date) => ({ commit: { committer: { date } } });
  assert.equal(isCommitInWindow(commitAt(window.apiSince), window), true);
  assert.equal(isCommitInWindow(commitAt("2026-07-26T15:59:59Z"), window), true);
  assert.equal(isCommitInWindow(commitAt(window.apiUntil), window), false);
});

test("sanitizer removes secret-like material and diff coordinates", () => {
  const sanitized = sanitizeText([
    "@@ -1,2 +1,2 @@",
    "api_key=supersecretvalue",
    "https://private.example/path",
    "import thing from '../private/module.js'",
    "select * from customer_records",
    "connect to database.internal",
    "email person@internal.example.com",
    "opaque abcdefghijklmnopqrstuvwxyzabcd",
    "hash 0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.doesNotMatch(sanitized, /supersecretvalue|private\.example|module\.js|customer_records|database\.internal|person@|abcdefghijklmnopqrstuvwxyzabcd|0123456789abcdef|@@/);
  assert.match(sanitized, /\[redacted\]|\[url\]/);
  assert.match(sanitized, /\[path\]|\[file\]/);
  assert.match(sanitized, /\[database-object\]|\[hostname\]/);
  assert.match(sanitized, /\[email\]/);
  assert.match(sanitized, /\[redacted-token\]|\[identifier\]/);
  assert.equal(shouldExcludePath("config/.env.production"), true);
  assert.equal(shouldExcludePath("src/page.jsx"), false);
});

test("branch membership treats only the configured production branch as production", () => {
  assert.equal(classifyBranchMembership(["feature", "main"], "main"), "production");
  assert.equal(classifyBranchMembership(["feature"], "main"), "development");
});

test("collector retains only the configured author and excludes bot identities", () => {
  const config = { authorLogins: ["tehbandit"], authorEmails: ["owner@example.com"] };
  assert.equal(isConfiguredAuthor({ author: { login: "TehBandit" }, commit: { author: {} } }, config), true);
  assert.equal(isConfiguredAuthor({ author: null, commit: { author: { email: "owner@example.com" } } }, config), true);
  assert.equal(isConfiguredAuthor({ author: { login: "someone-else" }, commit: { author: { email: "other@example.com" } } }, config), false);
  assert.equal(isAutomationActor({ author: { login: "dependabot[bot]" }, commit: { author: {} } }), true);
  assert.equal(isAutomationActor({ author: null, commit: { author: { name: "publisher[bot]" } } }), true);
});

test("collector compacts evidence to repository and total input ceilings", () => {
  const enriched = [
    { repositoryFullName: "TehBandit/one", projectLabel: "one", committedAt: "2026-07-20T12:00:00Z" },
    { repositoryFullName: "TehBandit/one", projectLabel: "one", committedAt: "2026-07-21T12:00:00Z" },
  ];
  const evidence = [
    { id: "e1", status: "development", summary: "first", sanitizedPatches: ["x".repeat(200)] },
    { id: "e2", status: "production", summary: "second", sanitizedPatches: ["y".repeat(200)] },
  ];
  const limited = limitEvidenceWithinCharacterBudgets(enriched, evidence, {
    maximumEvidenceCharactersPerRepository: 225,
    maximumPromptCharacters: 225,
  });

  assert.ok(limited.length > 0);
  assert.ok(JSON.stringify(limited).length <= 225);
  assert.equal(limited[0].sanitizedPatches.length, 0);
  assert.doesNotThrow(() => assertRepositoryEvidenceWithinLimits(
    limited.map(() => ({ repositoryFullName: "TehBandit/one", projectLabel: "one" })),
    limited,
    { maximumEvidenceCharactersPerRepository: 225 }
  ));
});

test("commits linked to the same pull request are consolidated and production wins", () => {
  const base = {
    repositoryFullName: "TehBandit/project",
    projectLabel: "Example Project",
    projectUrl: null,
    pullRequestNumber: 12,
    sha: "one",
    changedAreas: ["interface"],
    patches: ["first"],
    images: [],
    fileCount: 1,
    additions: 1,
    deletions: 0,
    sourceText: "first source",
    commitSummary: "first change",
    committedAt: "2026-07-20T12:00:00Z",
  };
  const consolidated = consolidatePullRequestEvidence([
    { ...base, status: "development" },
    {
      ...base,
      sha: "two",
      status: "production",
      changedAreas: ["tests"],
      patches: ["second"],
      committedAt: "2026-07-21T12:00:00Z",
    },
  ]);
  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].status, "production");
  assert.deepEqual(consolidated[0].changedAreas, ["interface", "tests"]);
  assert.deepEqual(summarizeProjects(consolidated), [
    { name: "Example Project", url: null, additions: 2, deletions: 0 },
  ]);
});

test("GitHub About links are normalized to safe HTTP(S) URLs", () => {
  assert.equal(normalizeProjectUrl("example.com/product"), "https://example.com/product");
  assert.equal(normalizeProjectUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeProjectUrl("javascript:alert(1)"), null);
  assert.equal(normalizeProjectUrl("not a url"), null);
});

test("only newly added raster files become project image candidates", () => {
  const commit = { projectLabel: "Example Project", repositoryFullName: "TehBandit/example" };
  assert.deepEqual(
    addedImageCandidate({ status: "added", filename: "assets/preview.PNG", sha: "blob1" }, commit),
    {
      project: "Example Project",
      repositoryFullName: "TehBandit/example",
      blobSha: "blob1",
      extension: "png",
    }
  );
  assert.equal(
    addedImageCandidate({ status: "modified", filename: "assets/preview.png", sha: "blob2" }, commit),
    null
  );
  assert.equal(
    addedImageCandidate({ status: "added", filename: "assets/preview.svg", sha: "blob3" }, commit),
    null
  );
});

test("selected project media is copied to a bounded public path", async () => {
  const originalFetch = globalThis.fetch;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "build-in-public-media-"));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      encoding: "base64",
      size: png.length,
      content: png.toString("base64"),
    }),
  });

  try {
    const prepared = await prepareProjectMedia({
      token: "test-token",
      projects: [{ name: "Example Project", url: null, additions: 2, deletions: 1 }],
      candidates: [{
        project: "Example Project",
        repositoryFullName: "TehBandit/example",
        blobSha: "image-blob",
        extension: "png",
      }],
      date: "2026-07-26",
      targetDirectory: temporaryDirectory,
      maximumImageBytes: 100,
      chooseIndex: () => 0,
    });
    assert.equal(
      prepared.projects[0].image,
      "/build-in-public/2026-07-26/example-project-1.png"
    );
    assert.deepEqual(await fs.readFile(prepared.writtenPaths[0]), png);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("private repository names are removed from model-bound evidence", () => {
  const commit = {
    repositoryVisibility: "private",
    repositoryFullName: "TehBandit/Secret-Sauce",
  };
  const value = redactPrivateProjectName(
    "secret-sauce improves the Secret Sauce experience in TehBandit/Secret-Sauce",
    commit
  );
  assert.doesNotMatch(value, /secret[- ]sauce/i);
  assert.match(value, /\[private project\]/);
});

test("installation repository pagination reads GitHub's object response", async () => {
  const originalFetch = globalThis.fetch;
  let page = 0;
  globalThis.fetch = async () => {
    page += 1;
    const repositories = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
      : [{ id: 101 }];
    return {
      ok: true,
      status: 200,
      json: async () => ({ total_count: 101, repositories }),
    };
  };

  try {
    const repositories = await githubPaginateObject(
      "test-token",
      "/installation/repositories",
      "repositories"
    );
    assert.equal(repositories.length, 101);
    assert.equal(page, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub request errors retain status codes for bounded merge retries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    statusText: "Conflict",
    json: async () => ({ message: "merge requirements are still pending" }),
  });
  try {
    await assert.rejects(
      githubRequest("test-token", "/repos/TehBandit/personal-website"),
      (error) => error.status === 409
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collector integration filters, deduplicates, classifies, and sanitizes evidence", async () => {
  const originalFetch = globalThis.fetch;
  const commit = (sha, date, login = "TehBandit", parents = [{ sha: "parent" }]) => ({
    sha,
    author: login ? { login } : null,
    parents,
    commit: {
      author: { email: login === "TehBandit" ? "owner@example.com" : "other@example.com", name: login },
      committer: { date },
    },
  });
  const productionCommit = commit("production", "2026-07-20T12:00:00Z");
  const developmentCommit = commit("development", "2026-07-21T12:00:00Z");
  const botCommit = commit("bot", "2026-07-22T12:00:00Z", "dependabot[bot]");

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const path = url.pathname;
    let body;
    if (path === "/installation/repositories") {
      body = {
        total_count: 1,
        repositories: [{
          name: "secret-project",
          full_name: "TehBandit/secret-project",
          private: true,
          homepage: "product.example",
          default_branch: "main",
          owner: { login: "TehBandit" },
        }],
      };
    } else if (path.endsWith("/branches")) {
      body = [{ name: "main" }, { name: "experiment" }];
    } else if (path.endsWith("/commits") && url.searchParams.get("sha") === "main") {
      body = [productionCommit];
    } else if (path.endsWith("/commits") && url.searchParams.get("sha") === "experiment") {
      body = [productionCommit, developmentCommit, botCommit];
    } else if (path.endsWith("/commits/production")) {
      body = {
        commit: { message: "secret-project navigation improvement" },
        files: [
          { filename: "src/private/navigation.jsx", status: "modified", patch: "+import item from '../private/module.js'" },
          { filename: "assets/preview.png", status: "added", sha: "image-blob" },
        ],
        stats: { additions: 4, deletions: 1 },
      };
    } else if (path.endsWith("/commits/development")) {
      body = {
        commit: { message: "drafting experiment" },
        files: [{ filename: "src/drafts.js", patch: "+connect to drafts.internal" }],
        stats: { additions: 2, deletions: 0 },
      };
    } else if (path.endsWith("/commits/production/pulls")) {
      body = [{ number: 1, title: "clearer navigation", body: "a more direct experience" }];
    } else if (path.endsWith("/commits/development/pulls")) {
      body = [{ number: 2, title: "drafting ideas", body: "still being explored" }];
    } else {
      throw new Error(`Unexpected mocked GitHub route: ${url}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };

  try {
    const collection = await collectWeeklyEvidence({
      token: "test-token",
      window: {
        apiSince: "2026-07-19T16:00:00Z",
        apiUntil: "2026-07-26T16:00:00Z",
      },
      config: {
        owner: "TehBandit",
        authorLogins: ["TehBandit"],
        authorEmails: ["owner@example.com"],
        productionBranchOverrides: {},
        publicRepositoryLabels: {},
        maximumRepositories: 10,
        maximumBranchesPerRepository: 10,
        maximumQualifyingCommits: 10,
        maximumFilesPerCommit: 10,
        maximumPatchCharactersPerFile: 1000,
        maximumEvidenceCharactersPerRepository: 10000,
      },
    });
    assert.equal(collection.repositoryCount, 1);
    assert.equal(collection.evidence.length, 2);
    assert.deepEqual(collection.evidence.map((item) => item.status).sort(), ["development", "production"]);
    assert.deepEqual(collection.projects, [
      {
        name: "Private Project 1",
        url: "https://product.example/",
        additions: 6,
        deletions: 1,
      },
    ]);
    assert.deepEqual(collection.imageCandidates, [
      {
        project: "Private Project 1",
        repositoryFullName: "TehBandit/secret-project",
        blobSha: "image-blob",
        extension: "png",
      },
    ]);
    const serialized = JSON.stringify(collection.evidence);
    assert.doesNotMatch(serialized, /secret-project|navigation\.jsx|module\.js|drafts\.internal|dependabot/i);
    assert.match(serialized, /Private Project 1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collector errors do not expose private repository names", async () => {
  const originalFetch = globalThis.fetch;
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [{
            name: "secret-project",
            full_name: "TehBandit/secret-project",
            private: true,
            default_branch: "main",
            owner: { login: "TehBandit" },
          }],
        }),
      };
    }
    return {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ message: "failure in TehBandit/secret-project" }),
    };
  };

  try {
    await assert.rejects(
      collectWeeklyEvidence({
        token: "test-token",
        window: { apiSince: "2026-07-19T16:00:00Z", apiUntil: "2026-07-26T16:00:00Z" },
        config: {
          owner: "TehBandit",
          authorLogins: ["TehBandit"],
          authorEmails: [],
          productionBranchOverrides: {},
          publicRepositoryLabels: {},
          maximumRepositories: 10,
          maximumBranchesPerRepository: 10,
        },
      }),
      (error) => !/secret-project/i.test(error.message) && /private project/i.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function postFixture(overrides = {}) {
  return {
    schemaVersion: 4,
    meta: {
      title: "Devlog: July 19, 2026 - July 26, 2026",
      description: "a short look at what shipped and what is still taking shape",
      slug: "building-in-public-2026-07-26",
      tag: "Development",
      date: "2026-07-26",
      periodStart: "2026-07-19T12:00:00-04:00",
      periodEnd: "2026-07-26T12:00:00-04:00",
      headerPhotos: [],
    },
    projects: [
      {
        name: "Example Project",
        url: "https://example.com/",
        image: null,
        changes: { additions: 12, deletions: 3 },
        bullets: [
          { text: "shipped a more focused experience for everyday use.", evidenceIds: ["e1"] },
        ],
        summary: {
          text: "i'm also exploring another idea that could simplify the broader workflow.",
          evidenceIds: ["e2"],
        },
      },
    ],
    ...overrides,
  };
}

const validationOptions = {
  config: { minimumWords: 1, maximumWords: 200 },
  evidence: [
    { id: "e1", project: "Example Project", status: "production" },
    { id: "e2", project: "Example Project", status: "development" },
  ],
  collectedProjects: [
    {
      name: "Example Project",
      url: "https://example.com/",
      image: null,
      additions: 12,
      deletions: 3,
    },
  ],
};

test("valid generated post passes static and evidence checks", () => {
  assert.deepEqual(validateGeneratedPost(postFixture(), validationOptions), []);
});

test("validation preserves unconventional source wording instead of rejecting typos", () => {
  const post = postFixture();
  post.projects[0].summary.text = "i'm doing alot of exploratory work around the broader workflow.";
  assert.deepEqual(validateGeneratedPost(post, validationOptions), []);
});

test("validation rejects line changes that differ from collected GitHub totals", () => {
  const post = postFixture();
  post.projects[0].changes.additions = 11;
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("must be +12 / -3")));
});

test("validation rejects project URLs that differ from GitHub About metadata", () => {
  const post = postFixture();
  post.projects[0].url = "https://other.example/";
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("must exactly match")));
});

test("validation rejects project images that differ from the collector selection", () => {
  const post = postFixture();
  post.projects[0].image = "/build-in-public/2026-07-26/other-project-1.png";
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("random selection")));
});

test("validation rejects uppercase prose and development work described as shipped", () => {
  const post = postFixture();
  post.projects[0].summary.text = "Shipped this experiment.";
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("lowercase")));
  assert.ok(errors.some((error) => error.includes("cannot be described as shipped")));
});

test("validation rejects a slug that is not derived from the post date", () => {
  const post = postFixture();
  post.meta.slug = "building-in-public-2026-07-19";
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("deterministically derived")));
});

test("OpenAI schema omits unsupported uniqueness while local validation enforces it", () => {
  const evidenceIds = openAIGeneratedPostSchema
    .properties.projects.items.properties.bullets.items.properties.evidenceIds;
  assert.equal("uniqueItems" in evidenceIds, false);

  const post = postFixture();
  post.projects[0].bullets[0].evidenceIds = ["e1", "e1"];
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("duplicate items")));
});

test("validation requires one correctly named section for every active project", () => {
  const post = postFixture();
  post.projects[0].name = "Wrong Project";
  const errors = validateGeneratedPost(post, validationOptions);
  assert.ok(errors.some((error) => error.includes("missing project section: Example Project")));
  assert.ok(errors.some((error) => error.includes("project section has no evidence: Wrong Project")));
});

test("deployment monitoring recognizes a generated post by changed file or merge title", () => {
  assert.equal(isGeneratedPostCommit({
    commit: { message: "a customized squash title" },
    files: [{ filename: "src/blogposts/generated/2026-07-26.json" }],
  }), true);
  assert.equal(isGeneratedPostCommit({
    commit: { message: "build in public: 2026-07-26 (#42)" },
    files: [],
  }), true);
  assert.equal(isGeneratedPostCommit({
    commit: { message: "ordinary site update" },
    files: [{ filename: "src/pages/Home.jsx" }],
  }), false);
  assert.equal(isProductionDeploymentEnvironment("Production"), true);
  assert.equal(isProductionDeploymentEnvironment("Preview"), false);
});
