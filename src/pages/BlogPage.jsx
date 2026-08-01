import { useParams } from "react-router-dom";
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

  return (
    <>
      <Header />

      <div className="beyond-red-line">
        {Post.meta.headerPhotos?.length > 0 && (
          <Carousel images={Post.meta.headerPhotos} />
        )}

        <div className={`mb-6 pl-4 ${Post.meta.headerPhotos?.length ? "" : "pt-8"}`}>
          <div className="text-3xl font-semibold">{Post.meta.title}</div>
          <div className="text-lg">{Post.meta.desc}</div>
          <div className="text-sm italic text-gray-400">{formatDate(Post.meta.date)}</div>
        </div>
        <div className={Post.generated ? "px-4 text-xl" : "px-8 text-xl"}>
          {Post.generated ? <GeneratedPost projects={Post.projects} /> : <Post.default />}
        </div>
      </div>

      <Footer />
    </>
  );
}
