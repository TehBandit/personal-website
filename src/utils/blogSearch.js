function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function postTag(post) {
  return post.meta.tag?.trim() || "General";
}

export function createSearchIndex(posts) {
  return posts.map((post) => ({
    post,
    tag: postTag(post),
    text: normalize([
      post.meta.title,
      post.meta.desc,
      postTag(post),
      post.searchText,
      ...(post.projects ?? []).flatMap((project) => [
        project.name,
        ...project.bullets.map((bullet) => bullet.text),
        project.summary.text,
      ]),
    ].join(" ")),
  }));
}

export function filterPosts(index, query, selectedTags) {
  const terms = normalize(query).split(" ").filter(Boolean);
  return index.filter(({ tag, text }) =>
    (selectedTags.length === 0 || selectedTags.includes(tag)) &&
    terms.every((term) => text.includes(term))
  ).map(({ post }) => post);
}
