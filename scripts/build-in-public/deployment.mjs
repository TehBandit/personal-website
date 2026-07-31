export function isGeneratedPostCommit(commit) {
  const subject = commit.commit?.message?.split("\n")[0] ?? "";
  const generatedFile = (commit.files ?? []).some((file) =>
    /^src\/blogposts\/generated\/\d{4}-\d{2}-\d{2}\.json$/.test(file.filename ?? "")
  );
  return generatedFile || /^build in public: \d{4}-\d{2}-\d{2} \(#\d+\)$/.test(subject);
}

export function isProductionDeploymentEnvironment(environment) {
  return /(?:^|\b)production(?:\b|$)/i.test(String(environment ?? ""));
}
