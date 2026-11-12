import BlogSeo from "../components/BlogSeo.jsx";
import { isoDate } from "../seo/blog-seo.js";
import { Link, useParams } from "react-router-dom";
import { posts } from "../blogposts";
import NotebookLayout, { NotebookTitle, PaperPin } from "../components/NotebookLayout.jsx";
import Carousel from "../components/Carousel.jsx";
import GeneratedPost from "../components/GeneratedPost.jsx";
import DoodleSurface from "../components/DoodleSurface.jsx";
import { formatDate } from "../utils/formatDate.js";
import "./BlogPage.css";

export default function BlogPage() {
  const { slug } = useParams();
  const Post = posts.find((p) => p.meta.slug === slug);
  if (!Post) return (
    <NotebookLayout>
      <main className="notebook-main home-margin-content">
        <NotebookTitle>blog</NotebookTitle>
        <p className="mb-4 text-home-ink-soft">Post not found.</p>
        <Link to="/blog" className="text-home-ink-blue underline underline-offset-4">← all posts</Link>
      </main>
    </NotebookLayout>
  );
  const relatedPosts = posts.filter((post) => post.meta.slug !== slug && post.meta.tag === Post.meta.tag).slice(0, 3);

  return (
    <NotebookLayout>
      <BlogSeo post={Post} />
      <main className="blog-post-page notebook-main home-margin-content">
        <NotebookTitle as="p" doodle="speech-bubble">blog</NotebookTitle>
        <DoodleSurface key={slug}>
          <div className="blog-post-layout">
            <aside className="blog-post-margin" aria-label="Post details">
              <Link to="/blog" className="blog-post-back">← all posts</Link>
              <div className="blog-post-meta">
                <time dateTime={isoDate(Post.meta.date)}>{formatDate(Post.meta.date)}</time>
                {Post.meta.tag && <span className="blog-post-category">{Post.meta.tag}</span>}
              </div>
            </aside>

            <article className="blog-post-article home-sheet" aria-labelledby="blog-post-title">
              <PaperPin tone="home-pin-yellow" />
              <span className="home-tape home-tape-blue blog-post-tape" aria-hidden="true" />
              <div className="blog-post-heading">
                <h1 id="blog-post-title">{Post.meta.title}</h1>
                {Post.meta.desc && <p className="blog-post-description">{Post.meta.desc}</p>}
              </div>

              {Post.meta.headerPhotos?.length > 0 && (
                <div className="blog-post-banner">
                  <Carousel images={Post.meta.headerPhotos} h="blog-post-banner-height" />
                </div>
              )}

              <div className="blog-post-body">
                {Post.generated ? <GeneratedPost projects={Post.projects} /> : <Post.default />}
              </div>

              {relatedPosts.length > 0 && (
                <aside className="blog-post-related" aria-label="Related posts">
                  <h2>more from the blog</h2>
                  <ul>
                    {relatedPosts.map((post) => (
                      <li key={post.meta.slug}>
                        <Link to={`/blog/${post.meta.slug}`}>{post.meta.title}</Link>
                      </li>
                    ))}
                  </ul>
                </aside>
              )}
            </article>
          </div>
        </DoodleSurface>
      </main>
    </NotebookLayout>
  );
}
