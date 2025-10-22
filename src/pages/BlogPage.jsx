import { useParams } from "react-router-dom";
import { posts } from "../blogposts";
import Header from "../components/Header.jsx";
import Carousel from "../components/Carousel.jsx";

export default function BlogPage() {
  const { slug } = useParams();
  const Post = posts.find((p) => p.meta.slug === slug);
  const contentStyle = {
    height: "160px",
    color: "#fff",
    lineHeight: "160px",
    textAlign: "center",
    background: "#364d79",
  };

  //   adjust this later to be a better 404 page
  if (!Post) return <h1>Post not found</h1>;

  return (
    <>
      <Header />

      <div className="beyond-red-line">
        <div>
          <Carousel images={Post.meta.headerPhotos}/>
        </div>

        <div className="mb-4 pl-4">
          <div className="text-5xl">{Post.meta.title}</div>
          <div className="text-2xl">{Post.meta.desc}</div>
          <div className="text-2xl italic">{Post.meta.date}</div>
        </div>
        <div className="px-8 text-2xl">
          <Post.default />
        </div>
      </div>
    </>
  );
}
