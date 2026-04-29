import { useParams } from "react-router-dom";
import { posts } from "../blogposts";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Carousel from "../components/Carousel.jsx";

export default function BlogPage() {
  const { slug } = useParams();
  const Post = posts.find((p) => p.meta.slug === slug);

  if (!Post) return <h1>Post not found</h1>;

  return (
    <>
      <Header />

      <div className="beyond-red-line">
        <div>
          <Carousel images={Post.meta.headerPhotos}/>
        </div>

        <div className="mb-4 pl-4">
          <div className="text-3xl font-semibold">{Post.meta.title}</div>
          <div className="text-lg">{Post.meta.desc}</div>
          <div className="text-sm italic text-gray-400">{Post.meta.date}</div>
        </div>
        <div className="px-8 text-xl">
          <Post.default />
        </div>
      </div>

      <Footer />
    </>
  );
}
