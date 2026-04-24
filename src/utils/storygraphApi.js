// Shared StoryGraph API helpers for consistent URL/query/body handling.

function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function buildApiUrl(path, query = {}) {
  return `${path}${buildQueryString(query)}`;
}

export async function requestJson(path, { method = "GET", query, body, headers, signal } = {}) {
  const url = buildApiUrl(path, query);
  const init = { method, headers: { ...(headers || {}) }, signal };

  if (body !== undefined) {
    if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const res = await fetch(url, init);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message = data?.error || `Server error ${res.status}`;
    throw new Error(message);
  }

  return data;
}
