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
        className={`bg-white p-6 rounded-lg shadow-lg w-1/2 ${
          isLeft ? "ml-auto" : "mr-auto"
        }`}
      >
        <div
          className={`flex space-x-4 font-light mb-4 ${
            isLeft ? "justify-end" : "mr-auto"
          }`}
        >
          <Tag color="success">{tag}</Tag>
          <p className="">{date}</p>
          {/* <p className="italic">8 min read...</p> */}
        </div>
        <div className="font-semibold text-2xl my-1">{title}</div>
        <div>{desc}</div>
        <div className="pt-4">
          <Link to={slug}>read full post →</Link>
        </div>
      </div>
    </div>
  );
}

export default BlogPost;
