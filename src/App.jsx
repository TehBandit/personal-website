import { Route, Routes } from "react-router-dom";
import Blog from "./pages/Blog.jsx";
import Home from "./pages/Home.jsx";
import BlogPage from "./pages/BlogPage.jsx";
import Resume from "./pages/Resume.jsx";
import NotFound from "./pages/NotFound.jsx";
import Groceries from "./pages/Groceries.jsx";
import GroceryBattle from "./pages/GroceryBattle.jsx";
import Contact from "./pages/Contact.jsx";

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPage />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/groceries" element={<Groceries />} />
        <Route path="/grocerybattle" element={<GroceryBattle />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default App;
