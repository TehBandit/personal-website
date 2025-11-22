import React from "react";
import defaultImg from "../assets/default.jpg";
import { Tag } from "antd";
import { Link } from "react-router-dom";

function BlogPost({
  isLeft,
  title = "Title",
  desc = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua",
  date = "99/99/9999",
  slug = "404",
  tag = "N/A",
}) {
  return (
    <div className="flex justify-center items-center -translate-y-1/3">
      <div
        className={`bg-white p-6 rounded-lg shadow-lg w-full ${
          isLeft ? "ml-auto" : "mr-[1vw]"
        }`}
      >
        <div
          className={`flex space-x-4 font-light lg:mb-4 ${
            isLeft ? "justify-end" : "mr-auto"
          }`}
        >
          {/* <Tag color="success">{tag}</Tag> */}
          <p className="flex-shrink flex-wrap break-words min-w-0">{date}</p>
          {/* <p className="italic">8 min read...</p> */}
        </div>
        <div className="font-semibold my-1">{title}</div>
        <div className="">{desc}</div>
        <div className="lg:pt-4 text-blue-500">
          <Link to={slug}>read full post →</Link>
        </div>
      </div>
    </div>
  );
}

export default BlogPost;
