import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import { Timeline } from "antd";
import BlogPost from "../components/BlogPost.jsx";
import { posts } from "../blogposts";

function Blog() {
  const timelineItems = posts.map((post, index) => ({
    children: (
      <BlogPost
        title={post.meta.title}
        desc={post.meta.desc}
        date={post.meta.date}
        slug={post.meta.slug}
        tag={post.meta.tag}
        isLeft={index % 2 !== 0} // alternate left/right if you want
      />
    ),
    color: "green",
  }));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="mt-24 beyond-red-line flex-grow">
        <Timeline mode="alternate" items={timelineItems} />
      </div>
      <Footer />
    </div>
  );
}

export default Blog;
