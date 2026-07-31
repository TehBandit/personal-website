const apiVersion = "2026-03-10";

export async function githubRequest(token, route, options = {}) {
  const url = route.startsWith("http") ? route : `https://api.github.com${route}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Accept: options.accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": apiVersion,
      "User-Agent": "tehbandit-build-in-public",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : response.statusText;
    const error = new Error(`GitHub API ${response.status} for ${new URL(url).pathname}: ${message}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function githubPaginate(token, route, { maximumPages = 20 } = {}) {
  const separator = route.includes("?") ? "&" : "?";
  const items = [];

  for (let page = 1; page <= maximumPages; page += 1) {
    const pageItems = await githubRequest(
      token,
      `${route}${separator}per_page=100&page=${page}`
    );
    if (!Array.isArray(pageItems)) {
      throw new Error(`Expected a paginated array from GitHub for ${route}.`);
    }
    items.push(...pageItems);
    if (pageItems.length < 100) return items;
  }

  throw new Error(`GitHub pagination exceeded ${maximumPages} pages for ${route}.`);
}

export async function githubPaginateObject(
  token,
  route,
  property,
  { maximumPages = 20 } = {}
) {
  const separator = route.includes("?") ? "&" : "?";
  const items = [];

  for (let page = 1; page <= maximumPages; page += 1) {
    const response = await githubRequest(
      token,
      `${route}${separator}per_page=100&page=${page}`
    );
    const pageItems = response?.[property];
    if (!Array.isArray(pageItems)) {
      throw new Error(`Expected GitHub response property ${property} for ${route}.`);
    }
    items.push(...pageItems);
    if (pageItems.length < 100) return items;
  }

  throw new Error(`GitHub pagination exceeded ${maximumPages} pages for ${route}.`);
}
