import { Route, Routes, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Blog from "./pages/Blog.jsx";
import Home from "./pages/Home.jsx";
import BlogPage from "./pages/BlogPage.jsx";
import Resume from "./pages/Resume.jsx";
import NotFound from "./pages/NotFound.jsx";
import GroceryBattle from "./pages/GroceryBattle.jsx";
import Contact from "./pages/Contact.jsx";
import BookclubLanding from "./pages/BookclubLanding.jsx";
import GuestBookVote from "./pages/GuestBookVote.jsx";

function App() {
  const location = useLocation();
  return (
    <>
      <div className="flex min-h-[100dvh] flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPage />} />
          <Route path="/resume" element={<Resume />} />
          <Route path="/grocerybattle" element={<GroceryBattle />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/bookclub" element={<BookclubLanding />} />
          <Route path="/bookclub/v/:code" element={<GuestBookVote />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      {!location.pathname.startsWith("/bookclub/v/") && <Analytics />}
    </>
  );
}

export default App;
