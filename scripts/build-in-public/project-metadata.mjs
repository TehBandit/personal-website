export function normalizeProjectUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const raw = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function summarizeProjects(commits) {
  const projects = new Map();
  for (const commit of commits) {
    const current = projects.get(commit.projectLabel) ?? {
      name: commit.projectLabel,
      url: commit.projectUrl ?? null,
      additions: 0,
      deletions: 0,
    };
    current.additions += commit.additions ?? 0;
    current.deletions += commit.deletions ?? 0;
    projects.set(commit.projectLabel, current);
  }
  return [...projects.values()].sort((left, right) => left.name.localeCompare(right.name));
}
