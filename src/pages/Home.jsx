import { useState, useEffect } from "react";
import viteLogo from "/vite.svg";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Profile from "../components/Profile.jsx";
import BlogPost from "../components/BlogPost.jsx";
import Divider from "../components/Divider.jsx";
import { ReactTyped } from "react-typed";
import { posts } from "../blogposts";
import { Link } from "react-router-dom";
import { Github, Linkedin, Twitter, Mail } from "lucide-react";

function Home() {
  // Youtube API Setup
  const [latestVideoId, setLatestVideoId] = useState("nothing");
  const [error, setError] = useState("");
  const API_KEY = import.meta.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = "UCX-JpAVGwDuXLFF_RnJXWqA";

  const fetchLatestVideo = async () => {
    try {
      const res = await fetch(
        `/api/youtube-search?channelId=${CHANNEL_ID}&maxResults=1`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch from backend.");
      }

      const data = await res.json();

      if (!data.items || data.items.length === 0) {
        throw new Error("No videos found in response.");
      }

      const videoId = data.items[0]?.id?.videoId;
      if (!videoId) {
        throw new Error("No video ID found in API response.");
      }

      setLatestVideoId(videoId);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unexpected error fetching video.");
    }
  };

  // OpenAI API Setup
  const [response, setResponse] = useState("");

  const testOpenAI = async () => {
    const res = await fetch("/api/openai-test");
    const data = await res.json();
    setResponse(data.response);
  };

  // Runs when Home page loads
  useEffect(() => {
    fetchLatestVideo();
  }, []);

  return (
    <>
      <Header />
      <div className="beyond-red-line page-content">
        <div className="flex items-center bg-white rounded-2xl shadow-xl w-full p-[2vw]">
          {/* About Me */}
          <Profile />
          <div className="ml-16 lg:text-8xl text-3xl flex-shrink flex-wrap break-words min-w-0">
            <ReactTyped
              strings={["mingus.", "shmigly.", "minkris.", "marcus."]}
              typeSpeed={50}
              backDelay={1100}
              backSpeed={30}
              loop
            >
              <input type="text" />
            </ReactTyped>
            <p className="pt-4 lg:text-4xl text-xl">
              brooklyn-based artist, activist,{" "}
              <span className="typoEffect">unc</span>
            </p>
          </div>
        </div>
        {/* Blog Highlight */}
        <Divider rotate={0} text="latest blog post" />
        <div className="flex flex-col md:flex-row items-center bg-white rounded-2xl shadow-xl w-full p-4 md:p-[2vw] gap-4 md:gap-[2vw] h-auto overflow-hidden">
          <div className="flex-shrink-0 w-full md:w-auto">
            <Link to={`blog/${posts[0].meta.slug}`}>
              <div className="w-full md:w-[14vw] aspect-square">
                <img
                  src={posts[0].meta.headerPhotos[0]}
                  alt={posts[0].meta.title}
                  className="w-full h-full object-cover rounded-2xl shadow-xl"
                ></img>
              </div>
            </Link>
          </div>
          <div className="flex flex-col justify-between w-full h-auto md:h-[14vw] py-2 md:py-[3vw] overflow-hidden">
            <div className="font-extralight italic text-gray-500 text-sm md:text-base truncate">
              {posts[0].meta.date}
            </div>

            <div className="flex flex-col justify-center flex-grow overflow-hidden">
              <div className="font-semibold text-lg md:text-3xl leading-tight break-words line-clamp-2">
                {posts[0].meta.title}
              </div>
              <div className="text-base md:text-xl text-gray-700 mt-1 break-words line-clamp-3">
                {posts[0].meta.desc}
              </div>
            </div>

            <div className="text-blue-700 text-base md:text-xl mt-2">
              <Link to={`blog/${posts[0].meta.slug}`}>read full post →</Link>
            </div>
          </div>
        </div>
        <Divider rotate={0} text="latest socials" />
        <div className="responsive_card_grid">
          <div className="responsive_card">
            <div className="responsive_card_title">YouTube</div>
            <div className="responsive_card_content_container">
              <iframe
                src={`https://www.youtube.com/embed/${latestVideoId}?si=Wsy9vkV0vV9nhTvn`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="responsive_card_content"
              ></iframe>
            </div>
          </div>
          {/* TODO: THIS IS HARD-CODED BECAUSE I DO NOT WANT TO INTERACT WITH THE INSTAGRAM API RN */}
          <div className="responsive_card">
            <div className="responsive_card_title">(art) instagram</div>
            <div className="responsive_card_content_container">
              <a
                href="https://www.instagram.com/p/Cnu1c6wvns5/?img_index=1"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="/testInsta.jpg"
                  className="responsive_card_content"
                ></img>
              </a>
            </div>
          </div>
        </div>
        <Divider rotate={0} text="projects" />

        {/* Projects grid: 6 cards, 3 per row on md+, 2 per row on sm, 1 per row on mobile */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full">
          {["Untitled Project", "Untitled Project", "Untitled Project"].map(
            (n) => (
              <div
                key={n}
                className="bg-white rounded-2xl shadow-xl p-6 flex items-center justify-center h-40 md:h-48"
              >
                <div className="text-center">
                  <div className="font-semibold text-lg md:text-xl">{n}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    coming soon...
                  </div>
                </div>
              </div>
            )
          )}
        </div>
        <Divider rotate={0} text="testing" />
        <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
          <h1>🔮 OpenAI Test</h1>
          <button onClick={testOpenAI}>Run Test</button>
          {response && (
            <p style={{ marginTop: "1rem" }}>
              <strong>AI says:</strong> {response}
            </p>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Home;
