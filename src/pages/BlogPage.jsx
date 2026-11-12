import BlogSeo from "../components/BlogSeo.jsx";
import { AUTHOR_NAME, isoDate } from "../seo/blog-seo.js";
import { Link, useParams } from "react-router-dom";
import { posts } from "../blogposts";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Carousel from "../components/Carousel.jsx";
import GeneratedPost from "../components/GeneratedPost.jsx";
import { formatDate } from "../utils/formatDate.js";

export default function BlogPage() {
  const { slug } = useParams();
  const Post = posts.find((p) => p.meta.slug === slug);
  if (!Post) return <h1>Post not found</h1>;
  const relatedPosts = posts.filter((post) => post.meta.slug !== slug && post.meta.tag === Post.meta.tag).slice(0, 3);

  return (
    <>
      <BlogSeo post={Post} />
      <Header />
      <main className="beyond-red-line">
        {Post.meta.headerPhotos?.length > 0 && (
          <Carousel images={Post.meta.headerPhotos} />
        )}
        <div className={`mb-6 pl-4 ${Post.meta.headerPhotos?.length ? "" : "pt-8"}`}>
          <h1 className="text-3xl font-semibold">{Post.meta.title}</h1>
          <div className="text-lg">{Post.meta.desc}</div>
          <div className="text-sm italic text-gray-400">
            by <Link to="/resume" className="underline underline-offset-2">{Post.meta.author ?? AUTHOR_NAME}</Link>
            {" · "}<time dateTime={isoDate(Post.meta.date)}>{formatDate(Post.meta.date)}</time>
          </div>
        </div>
        <div className={Post.generated ? "px-4 text-xl" : "px-8 text-xl"}>
          {Post.generated ? <GeneratedPost projects={Post.projects} /> : <Post.default />}
        </div>
        {relatedPosts.length > 0 && (
          <aside className="mx-8 my-8 border-t border-gray-200 pt-4" aria-label="Related posts">
            <h2 className="pb-2 text-lg font-semibold text-gray-800">more from the blog</h2>
            <ul className="list-disc space-y-2 pl-5 text-base">
              {relatedPosts.map((post) => (
                <li key={post.meta.slug}>
                  <Link to={`/blog/${post.meta.slug}`} className="text-blue-600 underline underline-offset-2">{post.meta.title}</Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
      <Footer />
    </>
  );
}
