import { useParams } from "react-router-dom";
import { posts } from "../blogposts";
import Header from "../components/Header.jsx";

export default function BlogPage() {
  const { slug } = useParams();
  const Post = posts.find((p) => p.meta.slug === slug);

  //   adjust this later to be a better 404 page
  if (!Post) return <h1>Post not found</h1>;

  return (
    <>
      <Header />
      
      <div className="beyond-red-line">
        <div className="flex items-center justify-center bg-white pr-4 rounded-2xl shadow-xl italic py-24 mb-8">
        images will be placed here in the next update from the antd Carousel component...
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
