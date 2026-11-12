import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import BlogSeo from "../components/BlogSeo.jsx";
import NotebookLayout, { NotebookTitle } from "../components/NotebookLayout.jsx";
import BlogPost from "../components/BlogPost.jsx";
import DoodleSurface from "../components/DoodleSurface.jsx";
import { posts } from "../blogposts";
import { isoDate } from "../seo/blog-seo.js";
import { formatDate } from "../utils/formatDate.js";
import { createSearchIndex, filterPosts } from "../utils/blogSearch.js";
import "./Blog.css";

const sortedPosts = [...posts].sort(
  (a, b) => new Date(b.meta.date) - new Date(a.meta.date)
);
const searchIndex = createSearchIndex(sortedPosts);
const tags = [...new Set(searchIndex.map(({ tag }) => tag))].sort();

function Blog() {
  const searchInput = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const filteredPosts = filterPosts(searchIndex, query, selectedTags);
  const hasFilters = query.length > 0 || selectedTags.length > 0;

  function toggleTag(tag) {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((selected) => selected !== tag)
      : [...current, tag]);
  }

  function clearFilters() {
    setQuery("");
    setSelectedTags([]);
  }

  return (
    <NotebookLayout>
      <BlogSeo posts={sortedPosts} />
      <main className="notebook-main home-margin-content">
        <NotebookTitle doodle="speech-bubble">blog</NotebookTitle>
        <section className="blog-filters" aria-label="Search and filter posts">
          <label htmlFor="blog-search" className="blog-filter-label font-home-hand">find something to read</label>
          <div className="blog-search-field">
            <Search size={20} aria-hidden="true" />
            <input
              id="blog-search"
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all posts…"
              aria-describedby="blog-search-hint"
              aria-controls="blog-results"
            />
            {query && (
              <button
                type="button"
                className="blog-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  searchInput.current?.focus();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <p id="blog-search-hint" className="blog-search-hint">Search titles, descriptions, tags, and full articles.</p>
          <fieldset className="blog-tag-filters">
            <legend className="blog-filter-legend font-home-mono">filter by tag · select any</legend>
            <div className="blog-tag-options">
              <button
                type="button"
                className="blog-tag-option font-home-mono"
                aria-pressed={selectedTags.length === 0}
                aria-controls="blog-results"
                onClick={() => setSelectedTags([])}
              >all posts</button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="blog-tag-option font-home-mono"
                  aria-pressed={selectedTags.includes(tag)}
                  aria-controls="blog-results"
                  onClick={() => toggleTag(tag)}
                >{tag.toLowerCase()}</button>
              ))}
            </div>
          </fieldset>
          <div className="blog-filter-summary">
            <p role="status" aria-live="polite" aria-atomic="true">
              {filteredPosts.length} of {sortedPosts.length} {sortedPosts.length === 1 ? "post" : "posts"}
              {selectedTags.length > 0 && ` · ${selectedTags.join(" or ")}`}
            </p>
            {hasFilters && <button type="button" className="blog-reset" onClick={clearFilters}>clear all</button>}
          </div>
        </section>
        <DoodleSurface>
          <div id="blog-results">
            {filteredPosts.length > 0 ? (
              <ol className="blog-paper-timeline" aria-label="Blog posts, newest first">
                {filteredPosts.map((post, index) => (
                  <BlogPost
                    key={post.meta.slug}
                    title={post.meta.title}
                    desc={post.meta.desc}
                    date={formatDate(post.meta.date)}
                    machineDate={isoDate(post.meta.date)}
                    slug={post.meta.slug}
                    tag={post.meta.tag}
                    isLeft={index % 2 === 0}
                  />
                ))}
              </ol>
            ) : (
              <div className="blog-no-results home-sheet">
                <h2 className="font-home-hand">no posts found</h2>
                <p>Try a different search or change your selected tags.</p>
                <button type="button" className="blog-reset" onClick={clearFilters}>show all posts</button>
              </div>
            )}
          </div>
        </DoodleSurface>
      </main>
    </NotebookLayout>
  );
}

export default Blog;
