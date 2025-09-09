import { useState } from "react";
import viteLogo from "/vite.svg";
import "../App.css";
import Header from "../components/Header.jsx";
import Profile from "../components/Profile.jsx";
import BlogPost from "../components/BlogPost.jsx";
import { Divider } from "antd";
import { ReactTyped } from "react-typed";
import { posts } from "../blogposts";
import { Link } from "react-router-dom";

function Home() {
  return (
    <>
      <Header />
      <div className="beyond-red-line">
        <div className="text-8xl flex items-center bg-gray-100/60 pr-4 rounded-2xl shadow-xl">
          {/* About Me */}
          <Profile />
          <div className="ml-16">
            <ReactTyped
              strings={["mingus.", "shmigly.", "minkris.", "marcus."]}
              typeSpeed={50}
              backDelay={1100}
              backSpeed={30}
              loop
            >
              <input type="text" />
            </ReactTyped>
            <p className="text-6xl pt-4">
              brooklyn-based
              developer, artist, <span className="typoEffect">day-trader</span>*
            </p>
          </div>
        </div>

        {/* Blog Highlight */}
        {/* TBD: Update divider styling */}
        <div className="divider">
        <Divider
          orientation="left"
          style={{ borderColor: "#8ec5ff", fontSize: "22px" }}
          type="horizontal"
          size="large"
        >
          latest blog post
        </Divider>
        </div>
        <div className="translate-y-1/3">
          <BlogPost
            title={posts[0].meta.title}
            desc={posts[0].meta.desc}
            date={posts[0].meta.date}
            tag={posts[0].meta.tag}
            slug={"/blog/" + posts[0].meta.slug}
          />
        </div>
        <div className="divider pl-[-4px]">
        <Divider
          orientation="left"
          style={{ borderColor: "#8ec5ff", fontSize: "22px" }}
          type="horizontal"
          size="large"
        >
          more content
        </Divider>
        <div className="flex items-center bg-white rounded-2xl shadow-xl text-2xl p-4 italic">coming soon...</div>
        </div>
      </div>
    </>
  );
}

export default Home;
