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
import BookclubSupport from "./pages/BookclubSupport.jsx";
import BookclubPrivacy from "./pages/BookclubPrivacy.jsx";
import GuestBookVote from "./pages/GuestBookVote.jsx";

// The analytics script can remain loaded after navigation. Keep guest vote URLs
// out of analytics even when a visitor first opens a public page.
function excludeGuestVotes(event) {
  return new URL(event.url, window.location.origin).pathname.startsWith("/bookclub/v/")
    ? null
    : event;
}

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
          <Route path="/bookclub/support" element={<BookclubSupport />} />
          <Route path="/bookclub/privacy" element={<BookclubPrivacy />} />
          <Route path="/bookclub/v/:code" element={<GuestBookVote />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      {!location.pathname.startsWith("/bookclub/v/") && <Analytics beforeSend={excludeGuestVotes} />}
    </>
  );
}

export default App;
