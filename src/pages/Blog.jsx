import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import BlogPost from "../components/BlogPost.jsx";
import { posts } from "../blogposts";

function Blog() {
  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.meta.date) - new Date(a.meta.date)
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow beyond-red-line py-8">
        {/* ── Timeline container ── */}
        <div className="relative max-w-4xl mx-auto px-4">

          {/* Vertical spine — desktop only */}
          <div
            className="hidden md:block absolute left-1/2 -translate-x-px top-0 bottom-0 w-px
                        bg-gradient-to-b from-transparent via-gray-300 to-transparent"
          />

          {/* Mobile spine */}
          <div
            className="md:hidden absolute left-1 top-0 bottom-0 w-px
                        bg-gradient-to-b from-transparent via-gray-300 to-transparent"
          />

          {/* Posts */}
          <div className="flex flex-col">
            {sortedPosts.map((post, index) => (
              <BlogPost
                key={post.meta.slug}
                title={post.meta.title}
                desc={post.meta.desc}
                date={post.meta.date}
                slug={post.meta.slug}
                tag={post.meta.tag}
                isLeft={index % 2 === 0}
              />
            ))}
          </div>

          {/* End cap */}
          <div className="hidden md:flex justify-center mt-2">
            <div className="w-2 h-2 rounded-full bg-gray-300" />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Blog;
