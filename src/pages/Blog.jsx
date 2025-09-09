import React from "react";
import Header from "../components/Header.jsx";
import { Timeline } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import BlogPost from "../components/BlogPost.jsx";
import { useParams } from "react-router-dom";
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
    <>
      <Header />
      <div className="mt-24">
        <Timeline mode="alternate" items={timelineItems} />
      </div>
    </>
  );
}

export default Blog;
